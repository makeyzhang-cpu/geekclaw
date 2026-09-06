//! 工单 SLA：时限策略、首响/解决判定、超时升级。
//!
//! 商业现实：工单没有 SLA 就只是一张待办清单，客户不会为它付钱。这一层把
//! 「紧急工单 15 分钟首响」这类承诺变成可判定的数据。
//!
//! 设计取舍：
//! 1. **策略写死在代码里，不做成可配置项。** 真正的商业产品迟早要按套餐/客户
//!    定制时限，但那需要先有套餐体系；现在硬编码优先级→时限，等有了再外移。
//! 2. **`sla_state` 一旦离开 `none` 就是终态。** 首次违约即 `breached`，在解决
//!    时限内完结即 `met`。这样扫描任务不会重复写审计事件，也不会出现
//!    「首响达标但解决超时」这种需要第二状态位才能表达的复杂度 —— 对客户而言
//!    一次违约就是违约。
//! 3. **升级只做一次。** `sla_escalated` 防止每轮扫描都把优先级往上顶。

use nomifun_common::{TimestampMs, now_ms};
use nomifun_db::models::{CsTicketRow, CsTicketSlaPatch};

const MINUTE_MS: i64 = 60_000;
const HOUR_MS: i64 = 60 * MINUTE_MS;
const DAY_MS: i64 = 24 * HOUR_MS;

/// 优先级 → (首次响应时限, 解决时限)，单位毫秒。
///
/// 数值参考主流客服 SaaS 的公开档位，落在"说出口客户会觉得合理"的区间。
pub fn due_for(priority: &str) -> (i64, i64) {
    match priority {
        "urgent" => (15 * MINUTE_MS, 4 * HOUR_MS),
        "high" => (30 * MINUTE_MS, 8 * HOUR_MS),
        "low" => (24 * HOUR_MS, 72 * HOUR_MS),
        // normal 与未知值都走默认档：未知优先级不该悄悄拿到更宽松的时限。
        _ => (4 * HOUR_MS, 24 * HOUR_MS),
    }
}

/// 建单时落定时限。只写两个 due 列，其余留给后续事件。
pub fn initial_patch(priority: &str, created_at: TimestampMs) -> CsTicketSlaPatch {
    let (first_response, resolution) = due_for(priority);
    CsTicketSlaPatch {
        first_response_due_at: Some(Some(created_at + first_response)),
        resolution_due_at: Some(Some(created_at + resolution)),
        ..Default::default()
    }
}

/// 升级目标：违约工单往上顶一档优先级。已满档则保持不变。
pub fn escalated_priority(priority: &str) -> &'static str {
    match priority {
        "low" => "normal",
        "normal" => "high",
        _ => "urgent",
    }
}

/// 一次 SLA 判定的结果。
#[derive(Debug, Clone)]
pub struct SlaVerdict {
    pub patch: CsTicketSlaPatch,
    /// 是否需要升级（提优先级 + 写审计事件）。
    pub escalate: bool,
    /// 触发判定的原因，进审计事件正文。
    pub reason: &'static str,
}

/// 判定一张工单此刻的 SLA 状态。
///
/// 返回 `None` 表示无需写库（已关闭，或尚未到任何判定点）。
/// 只重评 `sla_state == 'none'` 的工单 —— 终态不重复处理。
pub fn evaluate(ticket: &CsTicketRow, now: TimestampMs) -> Option<SlaVerdict> {
    if ticket.closed_at.is_some() || ticket.sla_state != "none" {
        return None;
    }
    let first_breached = match (ticket.first_response_due_at, ticket.first_responded_at) {
        (Some(due), None) => now > due,
        _ => false,
    };
    let resolution_breached = match (ticket.resolution_due_at, ticket.resolved_at) {
        (Some(due), None) => now > due,
        _ => false,
    };
    if first_breached || resolution_breached {
        return Some(SlaVerdict {
            patch: CsTicketSlaPatch {
                sla_state: Some("breached".into()),
                ..Default::default()
            },
            escalate: !ticket.sla_escalated,
            reason: if first_breached {
                "sla.first_response.breached"
            } else {
                "sla.resolution.breached"
            },
        });
    }
    // 已在解决时限内完结 → 达标。未解决就不下结论，继续观察。
    if ticket.resolved_at.is_some() {
        return Some(SlaVerdict {
            patch: CsTicketSlaPatch {
                sla_state: Some("met".into()),
                ..Default::default()
            },
            escalate: false,
            reason: "sla.met",
        });
    }
    None
}

/// 状态流转到终态时补齐时间戳。返回 `None` 表示这次流转不触碰 SLA。
///
/// - `resolved` → 记 `resolved_at`
/// - `cancelled` / `closed` → 记 `resolved_at` + `closed_at`（不再计时）
pub fn on_status_change(status: &str, now: TimestampMs) -> Option<CsTicketSlaPatch> {
    match status {
        "resolved" => Some(CsTicketSlaPatch {
            resolved_at: Some(Some(now)),
            ..Default::default()
        }),
        "cancelled" => Some(CsTicketSlaPatch {
            resolved_at: Some(Some(now)),
            closed_at: Some(Some(now)),
            ..Default::default()
        }),
        _ => None,
    }
}

/// 人工首次响应时调用：只在 `first_responded_at` 为空时落定。
pub fn on_first_response(ticket: &CsTicketRow, now: TimestampMs) -> Option<CsTicketSlaPatch> {
    if ticket.first_responded_at.is_some() {
        return None;
    }
    Some(CsTicketSlaPatch {
        first_responded_at: Some(Some(now)),
        ..Default::default()
    })
}

/// 合并多个补丁（后者覆盖前者），用于「一次请求里同时记首响 + 判达标」。
pub fn merge(a: CsTicketSlaPatch, b: CsTicketSlaPatch) -> CsTicketSlaPatch {
    CsTicketSlaPatch {
        first_response_due_at: b.first_response_due_at.or(a.first_response_due_at),
        first_responded_at: b.first_responded_at.or(a.first_responded_at),
        resolution_due_at: b.resolution_due_at.or(a.resolution_due_at),
        resolved_at: b.resolved_at.or(a.resolved_at),
        closed_at: b.closed_at.or(a.closed_at),
        sla_state: b.sla_state.or(a.sla_state),
        sla_escalated: b.sla_escalated.or(a.sla_escalated),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ticket(priority: &str, created_at: TimestampMs) -> CsTicketRow {
        let (first, resolution) = due_for(priority);
        CsTicketRow {
            cs_ticket_id: "0190f5fe-7c00-7a00-8000-000000000001".into(),
            title: "t".into(),
            description: String::new(),
            status: "pending".into(),
            priority: priority.into(),
            cs_dialogue_id: None,
            cs_agent_id: None,
            assignee_id: None,
            visitor_name: String::new(),
            visitor_handle: String::new(),
            created_at,
            updated_at: created_at,
            first_response_due_at: Some(created_at + first),
            first_responded_at: None,
            resolution_due_at: Some(created_at + resolution),
            resolved_at: None,
            closed_at: None,
            sla_state: "none".into(),
            sla_escalated: false,
        }
    }

    #[test]
    fn urgent_gets_the_tightest_clock() {
        let (first, resolution) = due_for("urgent");
        assert_eq!(first, 15 * MINUTE_MS);
        assert_eq!(resolution, 4 * HOUR_MS);
    }

    #[test]
    fn unknown_priority_falls_back_to_normal_not_more_lenient() {
        assert_eq!(due_for("whatever"), due_for("normal"));
        assert!(due_for("whatever").0 < due_for("low").0);
    }

    #[test]
    fn before_any_deadline_nothing_is_decided() {
        let t = ticket("normal", 0);
        assert!(evaluate(&t, HOUR_MS).is_none());
    }

    #[test]
    fn missing_first_response_deadline_marks_breach_and_escalates() {
        let t = ticket("urgent", 0);
        let verdict = evaluate(&t, 20 * MINUTE_MS).expect("should breach");
        assert_eq!(verdict.patch.sla_state.as_deref(), Some("breached"));
        assert!(verdict.escalate);
        assert_eq!(verdict.reason, "sla.first_response.breached");
    }

    #[test]
    fn responded_then_missing_resolution_deadline_marks_breach() {
        let mut t = ticket("urgent", 0);
        t.first_responded_at = Some(MINUTE_MS);
        let verdict = evaluate(&t, 5 * HOUR_MS).expect("should breach");
        assert_eq!(verdict.reason, "sla.resolution.breached");
    }

    #[test]
    fn resolved_within_deadline_is_met() {
        let mut t = ticket("normal", 0);
        t.first_responded_at = Some(MINUTE_MS);
        t.resolved_at = Some(HOUR_MS);
        let verdict = evaluate(&t, 2 * HOUR_MS).expect("should be met");
        assert_eq!(verdict.patch.sla_state.as_deref(), Some("met"));
        assert!(!verdict.escalate);
    }

    #[test]
    fn terminal_states_are_never_re_evaluated() {
        let mut t = ticket("urgent", 0);
        t.sla_state = "breached".into();
        assert!(evaluate(&t, 10 * HOUR_MS).is_none());
    }

    #[test]
    fn already_escalated_ticket_is_not_escalated_twice() {
        let mut t = ticket("urgent", 0);
        t.sla_escalated = true;
        let verdict = evaluate(&t, 20 * MINUTE_MS).expect("should breach");
        assert!(!verdict.escalate);
    }

    #[test]
    fn closed_tickets_are_skipped_entirely() {
        let mut t = ticket("urgent", 0);
        t.closed_at = Some(MINUTE_MS);
        assert!(evaluate(&t, 10 * HOUR_MS).is_none());
    }

    #[test]
    fn first_response_is_only_stamped_once() {
        let t = ticket("normal", 0);
        assert!(on_first_response(&t, 100).is_some());
        let mut responded = t.clone();
        responded.first_responded_at = Some(50);
        assert!(on_first_response(&responded, 100).is_none());
    }

    #[test]
    fn cancelling_stops_the_clock() {
        let patch = on_status_change("cancelled", 42).expect("cancelled should patch");
        assert_eq!(patch.resolved_at, Some(Some(42)));
        assert_eq!(patch.closed_at, Some(Some(42)));
        assert!(on_status_change("in_progress", 42).is_none());
    }

    #[test]
    fn merge_lets_later_patch_win() {
        let a = CsTicketSlaPatch {
            sla_state: Some("none".into()),
            resolved_at: Some(Some(1)),
            ..Default::default()
        };
        let b = CsTicketSlaPatch {
            sla_state: Some("met".into()),
            ..Default::default()
        };
        let merged = merge(a, b);
        assert_eq!(merged.sla_state.as_deref(), Some("met"));
        assert_eq!(merged.resolved_at, Some(Some(1)));
    }

    #[test]
    fn escalation_ladder_caps_at_urgent() {
        assert_eq!(escalated_priority("low"), "normal");
        assert_eq!(escalated_priority("normal"), "high");
        assert_eq!(escalated_priority("high"), "urgent");
        assert_eq!(escalated_priority("urgent"), "urgent");
    }

    #[test]
    fn initial_patch_derives_both_deadlines() {
        let patch = initial_patch("high", 1_000);
        assert_eq!(patch.first_response_due_at, Some(Some(1_000 + 30 * MINUTE_MS)));
        assert_eq!(patch.resolution_due_at, Some(Some(1_000 + 8 * HOUR_MS)));
    }

    #[test]
    fn day_constant_is_sane() {
        assert_eq!(DAY_MS, 86_400_000);
        let _ = now_ms();
    }
}
