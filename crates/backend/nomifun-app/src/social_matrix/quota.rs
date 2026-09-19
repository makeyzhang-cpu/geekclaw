/*
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

//! 社媒矩阵加装包的额度口径与闸门（迁移 047）。
//!
//! ## 「一组」到底指什么
//!
//! 「品牌账号组」是加装包的计价单位：1 组 = 1 个品牌 × 各平台 1 个账号。
//! **用量口径是「各平台账号数的最大值」，不是账号总数** —— 这与聚合商
//! （Ayrshare）按 Profile 计费的方式严格对齐：
//!
//! | 连接情况 | 组数 | 聚合商侧成本 |
//! |---|---|---|
//! | LinkedIn + FB + IG + YT + TikTok 各 1 个 | 1 | 1 个 Profile |
//! | 上述基础上再加 1 个 FB 主页 | 2 | 2 个 Profile |
//! | 5 个平台里 FB 有 2 个主页、其余各 1 个 | 2 | 2 个 Profile |
//!
//! 若按「账号总数」计，第一例会算成 5 组 —— 对客户严重超收，且与我们的实际
//! 成本完全脱钩。**改动这一口径前先读这段和迁移 047 的文件头。**
//!
//! ## 为什么闸门同时设在「同步」和「投递」两处
//!
//! 聚合商的 Profile 是我们调 API 建的（`create_profile`），所以**真正的成本闸门
//! 应该在创建 Profile 那一刻**。但该接口尚未接入（等聚合商选型定下来），当前先用
//! 两道可落地的近似闸门顶上：
//!   1. [`super::engine::SocialEngine::sync_accounts`] —— 拉远端账号时校验，
//!      超出额度不落库；
//!   2. [`super::engine::SocialEngine::dispatch_post`] —— 投递前校验，
//!      额度失效或超限不发。
//! 接入 `create_profile` 之后，第 1 道应改成「额度不足时**不创建**新 Profile」，
//! 那才是真正卡住成本的位置。

use std::collections::HashMap;

use serde::Serialize;

use nomifun_db::models::{SocialAccountRow, SocialEntitlement};

use super::driver::LinkedAccount;

/// 额度充足，社媒功能可正常使用。
pub const SOCIAL_QUOTA_OK: &str = "ok";
/// 未购买加装包（`social_groups = 0`）。
pub const SOCIAL_QUOTA_NONE: &str = "none";
/// 加装包已到期。
pub const SOCIAL_QUOTA_EXPIRED: &str = "expired";
/// 已连接的组数超过已购额度。
pub const SOCIAL_QUOTA_OVER: &str = "over";

/// 额度状态视图。**桌面端直接照这个渲染**，不要再在前端重算一遍口径 ——
/// 两处各算一次，早晚会算出两个不一样的数。
#[derive(Debug, Clone, Serialize)]
pub struct SocialQuotaView {
    /// 已购组数。`0` = 未购买。
    pub groups: i64,
    /// 已用组数（各平台账号数的**最大值**，见模块头）。
    pub used: i64,
    /// 到期时间（epoch millis）。`None` = 无到期（后台手工开通）。
    pub expires_at: Option<i64>,
    /// 见上方四个状态常量。
    pub status: &'static str,
    /// 可直接展示给用户的说明。`ok` 时为 `None`。
    pub message: Option<String>,
}

/// 从**远端驱动**返回的账号列表算用量。
///
/// 🔴 展开规则必须与 [`super::engine::SocialEngine::sync_accounts`] 完全一致：
/// 一个登录账号挂了主页就按主页数算，否则它自身算一个。两处口径一旦分叉，
/// 「界面显示 1 组、实际落库 3 行」这种账就再也对不平了。
pub fn used_from_remote(accounts: &[LinkedAccount]) -> i64 {
    let mut counts: HashMap<&str, i64> = HashMap::new();
    for acc in accounts {
        let n = if acc.subaccounts.is_empty() {
            1
        } else {
            acc.subaccounts.len() as i64
        };
        *counts.entry(acc.platform.as_str()).or_insert(0) += n;
    }
    max_count(counts)
}

/// 从**本地账号行**算用量。每行就是一个可投递目标，所以直接按平台计数。
pub fn used_from_local(accounts: &[SocialAccountRow]) -> i64 {
    let mut counts: HashMap<&str, i64> = HashMap::new();
    for acc in accounts {
        *counts.entry(acc.platform.as_str()).or_insert(0) += 1;
    }
    max_count(counts)
}

fn max_count(counts: HashMap<&str, i64>) -> i64 {
    counts.into_values().max().unwrap_or(0)
}

/// 组装额度状态视图。
pub fn view(entitlement: Option<&SocialEntitlement>, used: i64, now_ms: i64) -> SocialQuotaView {
    let groups = entitlement.map(|e| e.social_groups).unwrap_or(0);
    let expires_at = entitlement.and_then(|e| e.social_expires_at);

    // 「未购买」与「已到期」必须分开：前者要引导去购买，后者要引导去续费。
    // 混成一句「额度不可用」，已付费的客户会以为我们弄丢了他的订单。
    let status = if groups <= 0 {
        SOCIAL_QUOTA_NONE
    } else if !entitlement
        .map(|e| e.is_active_at(now_ms))
        .unwrap_or(false)
    {
        SOCIAL_QUOTA_EXPIRED
    } else if used > groups {
        SOCIAL_QUOTA_OVER
    } else {
        SOCIAL_QUOTA_OK
    };

    // 文案刻意不带具体日期：`expires_at` 已经在字段里，前端有 Date 可以本地化，
    // 后端再格式化一遍只会多引一个日期库、还容易与时区打架。
    let message = match status {
        SOCIAL_QUOTA_NONE => Some(
            "尚未购买「海外社媒矩阵」加装包。社媒矩阵不包含在任何套餐内，需单独购买后才能连接平台账号。"
                .to_string(),
        ),
        SOCIAL_QUOTA_EXPIRED => Some(
            "社媒矩阵加装包已到期，续费后即可继续连接与发布（已连接的账号与历史内容都会保留）。"
                .to_string(),
        ),
        SOCIAL_QUOTA_OVER => Some(format!(
            "已连接的品牌账号组（{used} 组）超出已购额度（{groups} 组）。请断开多余账号，或购买更多组。"
        )),
        _ => None,
    };

    SocialQuotaView {
        groups,
        used,
        expires_at,
        status,
        message,
    }
}

/// 额度闸门。通过返回 `Ok(())`；不通过返回**带上完整数据的视图**，
/// 调用方据此既能写日志也能原样交给界面显示。
pub fn check(
    entitlement: Option<&SocialEntitlement>,
    used: i64,
    now_ms: i64,
) -> Result<(), SocialQuotaView> {
    let v = view(entitlement, used, now_ms);
    if v.status == SOCIAL_QUOTA_OK {
        Ok(())
    } else {
        Err(v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::driver::LinkedSubaccount;

    fn remote(platform: &str, subaccounts: usize) -> LinkedAccount {
        LinkedAccount {
            provider_account_id: format!("{platform}-acct"),
            platform: platform.to_string(),
            handle: None,
            display_name: None,
            avatar_url: None,
            subaccounts: (0..subaccounts)
                .map(|i| LinkedSubaccount {
                    id: format!("{platform}-page-{i}"),
                    name: format!("page {i}"),
                })
                .collect(),
        }
    }

    fn entitlement(groups: i64, expires_at: Option<i64>) -> SocialEntitlement {
        SocialEntitlement {
            social_groups: groups,
            social_expires_at: expires_at,
        }
    }

    /// 五个平台各一个账号 = **1 组**（不是 5 组）。这是整个口径的核心。
    #[test]
    fn five_platforms_one_account_each_is_one_group() {
        let accounts = [
            remote("linkedin", 0),
            remote("facebook", 0),
            remote("instagram", 0),
            remote("youtube", 0),
            remote("tiktok", 0),
        ];
        assert_eq!(used_from_remote(&accounts), 1);
    }

    /// 同平台第 2 个账号才占第 2 组。
    #[test]
    fn second_account_on_same_platform_is_second_group() {
        let accounts = [
            remote("linkedin", 0),
            remote("facebook", 2), // 1 个 FB 登录账号挂了 2 个主页
            remote("instagram", 0),
        ];
        assert_eq!(used_from_remote(&accounts), 2);
    }

    #[test]
    fn empty_remote_uses_nothing() {
        assert_eq!(used_from_remote(&[]), 0);
    }

    #[test]
    fn status_none_when_never_purchased() {
        let v = view(None, 0, 1_000);
        assert_eq!(v.status, SOCIAL_QUOTA_NONE);
        assert!(v.message.is_some());
    }

    #[test]
    fn status_expired_beats_over() {
        // 已到期 + 超量：应当先说「到期」，因为续费才是出路。
        let ent = entitlement(1, Some(500));
        let v = view(Some(&ent), 3, 1_000);
        assert_eq!(v.status, SOCIAL_QUOTA_EXPIRED);
    }

    #[test]
    fn status_over_when_used_exceeds_groups() {
        let ent = entitlement(2, Some(9_999));
        assert_eq!(view(Some(&ent), 3, 1_000).status, SOCIAL_QUOTA_OVER);
        assert_eq!(view(Some(&ent), 2, 1_000).status, SOCIAL_QUOTA_OK);
    }

    /// 无到期（`None`）表示永久有效，不能被判成已到期。
    #[test]
    fn none_expiry_never_expires() {
        let ent = entitlement(1, None);
        assert_eq!(view(Some(&ent), 1, i64::MAX / 2).status, SOCIAL_QUOTA_OK);
    }

    #[test]
    fn check_passes_only_when_ok() {
        let ent = entitlement(1, Some(9_999));
        assert!(check(Some(&ent), 1, 1_000).is_ok());
        let blocked = check(Some(&ent), 2, 1_000).unwrap_err();
        assert_eq!(blocked.status, SOCIAL_QUOTA_OVER);
        assert_eq!(blocked.groups, 1);
        assert_eq!(blocked.used, 2);
    }
}
