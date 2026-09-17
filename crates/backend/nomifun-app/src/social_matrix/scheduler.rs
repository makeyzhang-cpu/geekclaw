/*
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

//! 海外社媒矩阵 —— 常驻调度器。
//!
//! ## 为什么必须常驻在服务端
//!
//! 「排期帖到点要发出去」是本功能的**核心承诺**。如果排期由桌面端定时器驱动，
//! 用户合上笔记本的那一刻承诺就失效了。所以调度器跟着云端进程活着，与桌面端
//! 是否开机无关 —— 这也是「引擎必须常驻云端」的**决定性理由**。
//!
//! ## 职责
//!
//! 1. **到点投递**：轮询 `status='scheduled' AND scheduled_at <= now` 的内容并投递。
//!    重启后第一次 tick 会立刻执行 —— 服务停机期间到期内容会补发，这是有意的。
//! 2. **指标回收**：按较低频率逐用户拉取已成功投递目标的指标快照。
//!
//! ## 失败语义
//!
//! 单条内容投递失败**只记日志、不中断整轮**：一条坏数据不该拖住其他人的排期。
//!
//! 三种终局各有归属，不会静默卡在「投递中」：
//!   * **真失败** → `dispatch_post` 把目标落实成 `failed` 并写明原因；
//!   * **触发限流** → 目标留在 `queued`，帖子被**退回 `scheduled`** 并推后
//!     `scheduled_at`，本调度器下一轮自然接着发（跨进程重启依然有效）；
//!   * **排队超过上限** → 转为 `failed`，并写明试了几次。
//!
//! HTTP 立即发布端点与这里复用同一份逻辑，所以手动发也有一致的排队行为。

use std::sync::Arc;
use std::time::Duration;

use nomifun_common::now_ms;

use super::driver::OutcomeStatus;
use super::engine::SocialEngine;

/// 调度器参数。默认值面向单实例 SaaS：30 秒一轮、每轮最多 20 条，
/// 指标每 30 分钟回收一次。
#[derive(Debug, Clone)]
pub struct SocialSchedulerConfig {
    /// 轮询间隔。30 秒足够让「准点」体感成立，又不会打爆数据库。
    pub tick: Duration,
    /// 每轮最多处理多少条到期内容（避免一次事务占满连接池）。
    pub batch: i64,
    /// 每多少轮做一次指标回收（0 = 关闭）。
    pub metrics_every_ticks: u64,
    /// 指标回收时最多遍历多少用户。
    pub metrics_user_batch: i64,
}

impl Default for SocialSchedulerConfig {
    fn default() -> Self {
        Self {
            tick: Duration::from_secs(30),
            batch: 20,
            metrics_every_ticks: 60,
            metrics_user_batch: 200,
        }
    }
}

/// 启动常驻调度器。
///
/// 采用与 `nomifun_customer_service::spawn_sla_monitor` 相同的 fire-and-forget
/// 形态：任务生命周期 = 进程生命周期。**刻意不返回句柄** —— 定时投递是这个
/// 模块的核心承诺，任何「句柄被丢弃就静默停掉」的设计都是缺陷。
pub fn spawn_social_scheduler(engine: Arc<SocialEngine>, config: SocialSchedulerConfig) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(config.tick);
        // 上一轮跑超时了就跳过积压的 tick，而不是连补多次把数据库打满。
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut ticks: u64 = 0;
        loop {
            // 第一次 tick 立即返回：进程刚起来就把停机期间到期的内容补发掉。
            ticker.tick().await;
            ticks = ticks.wrapping_add(1);
            dispatch_due(&engine, config.batch).await;
            if config.metrics_every_ticks > 0 && ticks % config.metrics_every_ticks == 0 {
                recycle_metrics(&engine, config.metrics_user_batch).await;
            }
        }
    });
}

/// 把到期的排期内容投递出去。
async fn dispatch_due(engine: &SocialEngine, batch: i64) {
    let due = match engine.repo().list_due_posts(now_ms(), batch).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("社交调度器：查询到期内容失败：{e}");
            return;
        }
    };
    if due.is_empty() {
        return;
    }
    tracing::info!(count = due.len(), "社交调度器：发现到期内容，开始投递");

    for post in due {
        match engine.dispatch_post(&post.post_id).await {
            Ok(outcomes) => {
                let ok = outcomes
                    .iter()
                    .filter(|o| o.status == OutcomeStatus::Success)
                    .count();
                let failed = outcomes
                    .iter()
                    .filter(|o| o.status == OutcomeStatus::Failed)
                    .count();
                let queued = outcomes
                    .iter()
                    .filter(|o| o.status == OutcomeStatus::Queued)
                    .count();
                let skipped = outcomes.len().saturating_sub(ok + failed + queued);
                tracing::info!(
                    post_id = %post.post_id,
                    user_id = %post.user_id,
                    success = ok,
                    failed,
                    queued,
                    skipped,
                    "社交调度器：投递完成"
                );
            }
            // 整体性故障，引擎内部已把目标状态落实完毕，这里只留痕 ——
            // 不让一条内容影响本轮其余排期：
            //   * 可重试的（服务商限流 / 网络抖动）→ 目标退回 `queued`、
            //     帖子退回 `scheduled` 并推后，下一轮 tick 到点接着发；
            //   * 不可重试的（密钥失效 / 驱动未配置）→ 目标落实成 `failed`
            //     并写明原因，等用户点「重新发布」。
            // 两种情况这里都**不能再改状态**，否则会把引擎刚设好的排期覆盖掉。
            Err(e) => {
                tracing::warn!(
                    post_id = %post.post_id,
                    user_id = %post.user_id,
                    "社交调度器：投递失败：{e}"
                );
            }
        }
    }
}

/// 逐用户回收指标快照。
async fn recycle_metrics(engine: &SocialEngine, user_batch: i64) {
    let users = match engine.repo().list_social_user_ids(user_batch).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("社交调度器：取用户列表失败：{e}");
            return;
        }
    };
    for user_id in users {
        match engine.refresh_metrics(&user_id, 200).await {
            Ok(0) => {}
            Ok(n) => tracing::debug!(user_id = %user_id, samples = n, "社交调度器：指标已回收"),
            Err(e) => tracing::warn!(user_id = %user_id, "社交调度器：指标回收失败：{e}"),
        }
    }
}
