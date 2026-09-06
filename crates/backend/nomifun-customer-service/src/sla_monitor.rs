//! 后台 SLA 扫描：把「超时」这件事在没人点开页面的情况下也发生。
//!
//! SLA 的价值在于**被动生效** —— 坐席去吃午饭时，超时工单自己升到最高优先级
//! 并留下审计记录。如果只有打开页面才判定，那它就不是 SLA，只是一个标签。
//!
//! 扫描频率 60 秒：比最紧的 15 分钟首响时限细一个数量级，代价可忽略。

use std::sync::Arc;
use std::time::Duration;

use nomifun_common::{TimestampMs, now_ms};
use nomifun_db::DbError;
use nomifun_db::ICustomerServiceRepository;
use nomifun_db::models::{CsAuditEventRow, CsTicketRow};
use serde::{Deserialize, Serialize};

use crate::sla;

const SCAN_INTERVAL: Duration = Duration::from_secs(60);

/// 一次扫描的产出，直接回给调用方（管理端点 / 日志）。
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct SlaScanReport {
    /// 被判定（写入新状态）的工单数。
    pub scanned: usize,
    /// 其中判定为违约的数量。
    pub breached: usize,
    /// 其中触发升级的数量。
    pub escalated: usize,
}

/// 扫描所有开放工单并落定 SLA 判定。
///
/// 幂等：只重评 `sla_state == 'none'` 的工单，终态不重复处理，
/// 所以重复调用不会重复升级或重复写审计事件。
pub async fn scan_once(
    repo: &Arc<dyn ICustomerServiceRepository>,
    now: TimestampMs,
) -> Result<SlaScanReport, DbError> {
    let mut report = SlaScanReport::default();
    for ticket in repo.list_tickets_with_open_sla(now).await? {
        let Some(verdict) = sla::evaluate(&ticket, now) else {
            continue;
        };
        let mut patch = verdict.patch;
        if verdict.escalate {
            patch.sla_escalated = Some(true);
        }
        let updated = repo
            .update_ticket_sla(&ticket.cs_ticket_id, patch, now)
            .await?;

        let updated = if verdict.escalate {
            report.escalated += 1;
            let bumped = sla::escalated_priority(&updated.priority);
            repo.update_ticket(
                &updated.cs_ticket_id,
                &nomifun_db::UpdateCsTicketParams {
                    priority: Some(bumped.into()),
                    ..Default::default()
                },
                now,
            )
            .await?
        } else {
            updated
        };

        if updated.sla_state == "breached" {
            report.breached += 1;
        }
        report.scanned += 1;
        record_sla_audit(repo, &updated, verdict.reason, now).await;
    }
    Ok(report)
}

/// 写一条 SLA 审计事件。审计失败只告警 —— 它不能反过来让工单更新失败。
pub async fn record_sla_audit(
    repo: &Arc<dyn ICustomerServiceRepository>,
    ticket: &CsTicketRow,
    reason: &str,
    now: TimestampMs,
) {
    // cs_audit_events.cs_agent_id 非空，没有归属客服的工单无处可记。
    let Some(cs_agent_id) = ticket.cs_agent_id.clone() else {
        return;
    };
    let event = CsAuditEventRow {
        cs_agent_id,
        kind: reason.into(),
        platform: "ticket_sla".into(),
        detail: format!(
            "工单 {} 优先级 {} SLA 判定 {}",
            ticket.cs_ticket_id, ticket.priority, ticket.sla_state
        ),
        created_at: now,
    };
    if let Err(error) = repo.insert_audit_event(&event).await {
        tracing::warn!(%error, "failed to persist ticket SLA audit event");
    }
}

/// 启动后台扫描循环。返回后立即执行第一轮。
///
/// 调用方负责在进程生命周期内持有；任务本身是 detach 的，
/// 进程退出时随 runtime 一起结束，不需要显式取消。
pub fn spawn_sla_monitor(repo: Arc<dyn ICustomerServiceRepository>) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(SCAN_INTERVAL);
        loop {
            ticker.tick().await;
            let now = now_ms();
            match scan_once(&repo, now).await {
                Ok(report) if report.scanned > 0 => {
                    tracing::info!(
                        scanned = report.scanned,
                        breached = report.breached,
                        escalated = report.escalated,
                        "customer-service SLA scan"
                    );
                }
                Ok(_) => {}
                Err(error) => {
                    // 扫描失败不能让后台任务退出：下一轮继续试。
                    tracing::warn!(%error, "customer-service SLA scan failed");
                }
            }
        }
    });
}
