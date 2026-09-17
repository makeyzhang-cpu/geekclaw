//! 海外社媒矩阵（迁移 046）数据层冒烟测试。
//!
//! 覆盖本轮改动的关键路径：
//!   * 迁移建表 + `validate_id_schema_contract`（`init_database_memory` 会跑全套）；
//!   * `create_post` 落 `campaign` / `tags_json` / `media_json` 并逐平台建目标；
//!   * 账号幂等键含 `parent_handle` —— 同一个登录账号下的多个主页必须各自成行；
//!   * 所有按用户过滤的读取不得串租户；
//!   * `list_versions_for_user` 走父表过滤；
//!   * `reset_targets_for_retry` 只退失败/跳过的目标，成功的不重发；
//!   * 指标读取取「每 target 最新一次采样」而非累加。

use nomifun_common::{generate_id, now_ms};
use nomifun_db::{
    CreatePostParams, ISocialRepository, RecordMetricParams, SqliteSocialRepository,
    TargetResultParams, UpsertAccountParams, models,
};

async fn setup() -> (SqliteSocialRepository, sqlx::SqlitePool) {
    let db = nomifun_db::init_database_memory()
        .await
        .expect("init in-memory db with 046 migration + id contract");
    let pool = db.pool().clone();
    (SqliteSocialRepository::new(pool.clone()), pool)
}

/// 建一个真实 user 行 —— `users.user_id` 带 UUIDv7 CHECK，逻辑外键要能解析。
async fn seed_user(pool: &sqlx::SqlitePool, user_id: &str) {
    sqlx::query(
        "INSERT INTO users (user_id, username, password_hash, jwt_secret, created_at, updated_at) \
         VALUES (?, ?, '', '', 0, 0)",
    )
    .bind(user_id)
    .bind(user_id)
    .execute(pool)
    .await
    .expect("seed user");
}

async fn seed_account(
    repo: &SqliteSocialRepository,
    user_id: &str,
    platform: &str,
    provider_handle: &str,
    parent_handle: Option<&str>,
) -> String {
    repo.upsert_account(UpsertAccountParams {
        account_id: String::new(),
        user_id: user_id.to_string(),
        platform: platform.to_string(),
        driver: "aggregator".to_string(),
        vendor: Some("blotato".to_string()),
        provider_handle: Some(provider_handle.to_string()),
        parent_handle: parent_handle.map(str::to_string),
        display_name: Some(format!("{platform} 账号")),
        handle: Some(format!("@{platform}")),
        avatar_url: None,
        account_type: if parent_handle.is_some() {
            "page".to_string()
        } else {
            "profile".to_string()
        },
        token_expires_at: None,
        meta_json: None,
    })
    .await
    .expect("upsert account")
    .account_id
}

#[tokio::test]
async fn migration_and_id_contract_pass_for_social_matrix() {
    let (_repo, pool) = setup().await;
    let tables: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name LIKE 'social_%'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(tables, 7, "046 应建立 7 张 social_* 表");
}

#[tokio::test]
async fn account_upsert_is_idempotent_per_page_not_per_login() {
    let (repo, pool) = setup().await;
    let user_id = generate_id();
    seed_user(&pool, &user_id).await;

    // 同一个 FB 登录账号下的两个主页：provider_handle 相同、parent_handle 不同。
    let page_a = seed_account(&repo, &user_id, "facebook", "acct-1", Some("page-a")).await;
    let page_b = seed_account(&repo, &user_id, "facebook", "acct-1", Some("page-b")).await;
    assert_ne!(page_a, page_b, "两个主页必须是两行，不能互相覆盖");

    // 重复同步同一主页 → 幂等，不新增行。
    let again = seed_account(&repo, &user_id, "facebook", "acct-1", Some("page-a")).await;
    assert_eq!(again, page_a, "重复同步应命中同一行");

    let accounts = repo.list_accounts(&user_id).await.unwrap();
    assert_eq!(accounts.len(), 2, "应恰好两行（两个主页）");
    assert!(
        accounts.iter().all(|a| a.parent_handle.is_some()),
        "主页行的 parent_handle 必须留存（发布时作为 pageId）"
    );
}

#[tokio::test]
async fn reads_are_tenant_scoped() {
    let (repo, pool) = setup().await;
    let user_a = generate_id();
    let user_b = generate_id();
    seed_user(&pool, &user_a).await;
    seed_user(&pool, &user_b).await;

    let acc_a = seed_account(&repo, &user_a, "linkedin", "li-a", None).await;
    let acc_b = seed_account(&repo, &user_b, "linkedin", "li-b", None).await;

    let post_a = repo
        .create_post(CreatePostParams {
            post_id: String::new(),
            user_id: user_a.clone(),
            text: "A 的内容".to_string(),
            title: None,
            media_ids: Vec::new(),
            status: models::SOCIAL_POST_STATUS_DRAFT.to_string(),
            scheduled_at: None,
            source: "composer".to_string(),
            versions: vec![("linkedin".to_string(), "A 的领英文案".to_string())],
            targets: vec![(acc_a.clone(), "linkedin".to_string())],
            campaign: Some("Q3 出海".to_string()),
            tags: vec!["b2b".to_string(), "出海".to_string()],
        })
        .await
        .unwrap();

    // A 看不到 B 的账号；B 看不到 A 的内容。
    let accounts_a = repo.list_accounts(&user_a).await.unwrap();
    assert_eq!(accounts_a.len(), 1);
    assert_eq!(accounts_a[0].account_id, acc_a);

    let posts_b = repo.list_posts(&user_b, 50).await.unwrap();
    assert!(posts_b.is_empty(), "B 不该看到 A 的内容");

    // B 删不动 A 的内容，且不泄露存在性。
    assert!(!repo.delete_post(&post_a.post_id, &user_b).await.unwrap());
    assert!(!repo.delete_account(&acc_a, &user_b).await.unwrap());

    // A 自己能删。
    assert!(repo.delete_post(&post_a.post_id, &user_a).await.unwrap());

    // 账号列表互不干扰。
    let accounts_b = repo.list_accounts(&user_b).await.unwrap();
    assert_eq!(accounts_b.len(), 1);
    assert_eq!(accounts_b[0].account_id, acc_b);
}

#[tokio::test]
async fn create_post_persists_campaign_tags_media_and_targets() {
    let (repo, pool) = setup().await;
    let user_id = generate_id();
    seed_user(&pool, &user_id).await;
    let acc = seed_account(&repo, &user_id, "instagram", "ig-1", None).await;

    let media = repo
        .create_media(nomifun_db::CreateMediaParams {
            media_id: generate_id(),
            user_id: user_id.clone(),
            kind: "image".to_string(),
            mime_type: "image/jpeg".to_string(),
            file_name: Some("cover.jpg".to_string()),
            url: "https://cdn.example.com/cover.jpg".to_string(),
            bytes: Some(1234),
            width: Some(1080),
            height: Some(1080),
            duration_ms: None,
        })
        .await
        .unwrap();

    let post = repo
        .create_post(CreatePostParams {
            post_id: String::new(),
            user_id: user_id.clone(),
            text: "主文案".to_string(),
            title: None,
            media_ids: vec![media.media_id.clone()],
            status: models::SOCIAL_POST_STATUS_SCHEDULED.to_string(),
            scheduled_at: Some(now_ms() + 3_600_000),
            source: "composer".to_string(),
            versions: vec![("instagram".to_string(), "IG 改写文案".to_string())],
            targets: vec![(acc.clone(), "instagram".to_string())],
            campaign: Some("新品预热".to_string()),
            tags: vec!["预热".to_string()],
        })
        .await
        .unwrap();

    assert_eq!(post.campaign.as_deref(), Some("新品预热"));
    assert_eq!(post.text, "主文案");
    assert!(post.media_json.as_deref().unwrap().contains(&media.media_id));

    // 媒体随帖落库 —— 排期帖到点投递时请求早已结束，必须能从这里取回来。
    let raw: Vec<String> = serde_json::from_str(post.media_json.as_deref().unwrap()).unwrap();
    assert_eq!(raw, vec![media.media_id.clone()]);

    let targets = repo.list_targets(&post.post_id).await.unwrap();
    assert_eq!(targets.len(), 1);
    assert_eq!(targets[0].account_id, acc);
    assert_eq!(targets[0].status, models::SOCIAL_TARGET_STATUS_PENDING);

    // 批量取改写版本走父表租户过滤。
    let versions = repo.list_versions_for_user(&user_id, 50).await.unwrap();
    assert_eq!(versions.len(), 1);
    assert_eq!(versions[0].text, "IG 改写文案");

    // 排期帖应被调度器捞到。
    let due = repo.list_due_posts(now_ms() + 7_200_000, 10).await.unwrap();
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].post_id, post.post_id);
    assert_eq!(due[0].user_id, user_id);
}

#[tokio::test]
async fn retry_only_resets_failed_and_skipped_targets() {
    let (repo, pool) = setup().await;
    let user_id = generate_id();
    seed_user(&pool, &user_id).await;
    let acc_ok = seed_account(&repo, &user_id, "linkedin", "li-ok", None).await;
    let acc_bad = seed_account(&repo, &user_id, "facebook", "fb-bad", None).await;

    let post = repo
        .create_post(CreatePostParams {
            post_id: String::new(),
            user_id: user_id.clone(),
            text: "一稿多投".to_string(),
            title: None,
            media_ids: Vec::new(),
            status: models::SOCIAL_POST_STATUS_DRAFT.to_string(),
            scheduled_at: None,
            source: "composer".to_string(),
            versions: Vec::new(),
            targets: vec![
                (acc_ok.clone(), "linkedin".to_string()),
                (acc_bad.clone(), "facebook".to_string()),
            ],
            campaign: None,
            tags: Vec::new(),
        })
        .await
        .unwrap();

    let targets = repo.list_targets(&post.post_id).await.unwrap();
    let t_ok = targets.iter().find(|t| t.account_id == acc_ok).unwrap();
    let t_bad = targets.iter().find(|t| t.account_id == acc_bad).unwrap();

    // 3 成 2 败的常态化场景：这里造一条成功 + 一条失败。
    repo.mark_target_result(TargetResultParams {
        target_id: t_ok.target_id.clone(),
        status: models::SOCIAL_TARGET_STATUS_SUCCESS.to_string(),
        provider_post_id: Some("li-remote-1".to_string()),
        permalink: Some("https://linkedin.com/p/1".to_string()),
        error: None,
        text_snapshot: Some("一稿多投".to_string()),
    })
    .await
    .unwrap();
    repo.mark_target_result(TargetResultParams {
        target_id: t_bad.target_id.clone(),
        status: models::SOCIAL_TARGET_STATUS_FAILED.to_string(),
        provider_post_id: None,
        permalink: None,
        error: Some("Facebook 返回 400：pageId 无效".to_string()),
        text_snapshot: None,
    })
    .await
    .unwrap();

    // 帖级状态必须是 partial（既非全成也非全败）。
    let status = repo.refresh_post_status(&post.post_id).await.unwrap();
    assert_eq!(status.as_deref(), Some(models::SOCIAL_POST_STATUS_PARTIAL));

    // 重试只把失败的那条退回 pending；已发出去的成功目标不能重发。
    let reset = repo.reset_targets_for_retry(&post.post_id).await.unwrap();
    assert_eq!(reset, 1);
    let after = repo.list_targets(&post.post_id).await.unwrap();
    assert_eq!(
        after.iter().find(|t| t.target_id == t_ok.target_id).unwrap().status,
        models::SOCIAL_TARGET_STATUS_SUCCESS
    );
    let retried = after.iter().find(|t| t.target_id == t_bad.target_id).unwrap();
    assert_eq!(retried.status, models::SOCIAL_TARGET_STATUS_PENDING);
    assert!(retried.error.is_none(), "重试应清掉上一轮的失败原因");
}

#[tokio::test]
async fn metrics_are_read_as_latest_sample_not_summed() {
    let (repo, pool) = setup().await;
    let user_id = generate_id();
    seed_user(&pool, &user_id).await;
    let acc = seed_account(&repo, &user_id, "facebook", "fb-1", None).await;

    let post = repo
        .create_post(CreatePostParams {
            post_id: String::new(),
            user_id: user_id.clone(),
            text: "指标帖".to_string(),
            title: Some("指标帖".to_string()),
            media_ids: Vec::new(),
            status: models::SOCIAL_POST_STATUS_DRAFT.to_string(),
            scheduled_at: None,
            source: "composer".to_string(),
            versions: Vec::new(),
            targets: vec![(acc.clone(), "facebook".to_string())],
            campaign: None,
            tags: Vec::new(),
        })
        .await
        .unwrap();

    let targets = repo.list_targets(&post.post_id).await.unwrap();
    let target_id = targets[0].target_id.clone();
    repo.mark_target_result(TargetResultParams {
        target_id: target_id.clone(),
        status: models::SOCIAL_TARGET_STATUS_SUCCESS.to_string(),
        provider_post_id: Some("fb-remote-9".to_string()),
        permalink: Some("https://facebook.com/p/9".to_string()),
        error: None,
        text_snapshot: None,
    })
    .await
    .unwrap();

    // 两次采样：100 → 150（累计曝光，不是增量）。
    for (likes, impressions) in [(100i64, 5_000i64), (150, 8_000)] {
        repo.record_metric(RecordMetricParams {
            target_id: target_id.clone(),
            platform: "facebook".to_string(),
            likes,
            comments: 3,
            shares: 1,
            views: None,
            impressions: Some(impressions),
            saves: None,
            raw_json: None,
        })
        .await
        .unwrap();
    }

    let metrics = repo.list_latest_metrics(&user_id, 50).await.unwrap();
    assert_eq!(metrics.len(), 1, "同一 target 只应返回一条（最新采样）");
    assert_eq!(metrics[0].likes, 150, "必须是最后一次采样，不能累加");
    assert_eq!(metrics[0].impressions, Some(8_000));
    // 桌面端指标面板要求这两个字段齐备，缺任一会被整条丢弃。
    assert_eq!(metrics[0].account_id, acc);
    assert_eq!(metrics[0].provider_post_id.as_deref(), Some("fb-remote-9"));
}

#[tokio::test]
async fn failed_targets_keep_history_after_account_unbind() {
    let (repo, pool) = setup().await;
    let user_id = generate_id();
    seed_user(&pool, &user_id).await;
    let acc = seed_account(&repo, &user_id, "tiktok", "tt-1", None).await;

    let post = repo
        .create_post(CreatePostParams {
            post_id: String::new(),
            user_id: user_id.clone(),
            text: "会被解绑的账号".to_string(),
            title: None,
            media_ids: Vec::new(),
            status: models::SOCIAL_POST_STATUS_DRAFT.to_string(),
            scheduled_at: None,
            source: "composer".to_string(),
            versions: Vec::new(),
            targets: vec![(acc.clone(), "tiktok".to_string())],
            campaign: None,
            tags: Vec::new(),
        })
        .await
        .unwrap();

    assert!(repo.delete_account(&acc, &user_id).await.unwrap());

    // KeepHistory：账号没了，但投递记录必须留存（只有账号展示信息为 None）。
    let rows = repo.list_recent_targets(&user_id, 50).await.unwrap();
    let row = rows
        .iter()
        .find(|r| r.post_id == post.post_id)
        .expect("投递记录不能随账号解绑消失");
    assert_eq!(row.account_id, acc);
    assert!(row.account_display_name.is_none());
    assert!(row.account_handle.is_none());
}
