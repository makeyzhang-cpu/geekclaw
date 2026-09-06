/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// 5.0.32 客服统计报表看板（商业闭环最小集之一）。
//
// 为什么要这一页：对外卖的客服产品，客户第一句问的永远是"效果怎么样"。
// 没有数据就没有续费理由。所以这里只放**能直接回答商业问题**的指标：
//   · 接了多少、转人工多少（人力成本）
//   · 工单是否按时解决、超时多少（SLA 履约）
//   · 访客打几分、说了什么（满意度）
// 刻意不做花哨图表：数字 + 直方图足够支撑一次续费沟通，也更容易长期维护。

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Empty, Message, Select, Spin, Tag, Tooltip } from '@arco-design/web-react';
import { ChartHistogram, Left, Refresh, Shield } from '@icon-park/react';

import { ipcBridge } from '@/common';
import type { ICsRating, ICsStats } from '@/common/adapter/ipcBridge';
import type { CsAgentId } from '@/common/types/ids';
import { useCsAgents } from './useCsAgents';

const RANGES = [
  { key: '24h', hours: 24 },
  { key: '7d', hours: 24 * 7 },
  { key: '30d', hours: 24 * 30 },
  { key: 'all', hours: 0 },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];

/** 毫秒 → 人类可读时长（用于平均首响）。 */
const formatDuration = (ms: number): string => {
  if (ms <= 0) return '—';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
  const days = Math.floor(hours / 24);
  return `${days} 天 ${hours % 24} 小时`;
};

const formatTime = (ms: number): string => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 单个 KPI 卡片。 */
const StatCard: React.FC<{
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}> = ({ label, value, hint, tone = 'default' }) => {
  const color =
    tone === 'good'
      ? 'var(--color-success-6, #00B42A)'
      : tone === 'warn'
        ? 'var(--color-warning-6, #FF7D00)'
        : tone === 'bad'
          ? 'var(--color-danger-6, #F53F3F)'
          : 'var(--color-text-1)';
  return (
    <div
      className='flex flex-col gap-6px rd-12px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] px-16px py-14px'
      style={{ minWidth: 0 }}
    >
      <span className='text-12px text-t-tertiary truncate'>{label}</span>
      <span className='text-24px font-700 leading-30px' style={{ color }}>
        {value}
      </span>
      {hint ? <span className='text-11px text-t-tertiary leading-16px'>{hint}</span> : null}
    </div>
  );
};

const CsStatsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agents } = useCsAgents();

  const [agentFilter, setAgentFilter] = useState<CsAgentId | 'all'>('all');
  const [range, setRange] = useState<RangeKey>('7d');
  const [stats, setStats] = useState<ICsStats | null>(null);
  const [ratings, setRatings] = useState<ICsRating[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);

  const since = useMemo(() => {
    const hit = RANGES.find((r) => r.key === range);
    if (!hit || hit.hours === 0) return undefined;
    return Date.now() - hit.hours * 3600_000;
  }, [range]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        cs_agent_id: agentFilter === 'all' ? undefined : (agentFilter as CsAgentId),
        since,
      };
      const [nextStats, nextRatings] = await Promise.all([
        ipcBridge.customerService.getStats.invoke(params),
        ipcBridge.customerService.listRatings.invoke({ ...params, limit: 50 }),
      ]);
      setStats(nextStats);
      setRatings(Array.isArray(nextRatings) ? nextRatings : []);
    } catch {
      setStats(null);
      setRatings([]);
    } finally {
      setLoading(false);
    }
  }, [agentFilter, since]);

  useEffect(() => {
    void load();
  }, [load]);

  const runSlaScan = useCallback(async () => {
    setScanning(true);
    try {
      const report = await ipcBridge.customerService.scanTicketSla.invoke({});
      Message.success(
        t('customerService.stats.scanDone', {
          defaultValue: '扫描完成：检查 {{scanned}} 条，超时 {{breached}} 条，已升级 {{escalated}} 条',
          scanned: report.scanned,
          breached: report.breached,
          escalated: report.escalated,
        })
      );
      await load();
    } catch (e) {
      Message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [load, t]);

  const derived = useMemo(() => {
    if (!stats) return null;
    const avgFirstResponse =
      stats.tickets_responded > 0
        ? Math.round(stats.first_response_ms_sum / stats.tickets_responded)
        : 0;
    const avgScore = stats.ratings_count > 0 ? stats.ratings_score_sum / stats.ratings_count : 0;
    const takeOverRate =
      stats.dialogues_total > 0 ? stats.dialogues_taken_over / stats.dialogues_total : 0;
    const slaTotal = stats.tickets_met + stats.tickets_breached;
    const slaRate = slaTotal > 0 ? stats.tickets_met / slaTotal : 0;
    const maxBar = Math.max(1, ...stats.ratings_histogram);
    return { avgFirstResponse, avgScore, takeOverRate, slaRate, slaTotal, maxBar };
  }, [stats]);

  const agentName = useCallback(
    (id: string | null) => agents.find((a) => a.cs_agent_id === id)?.name ?? '—',
    [agents]
  );

  return (
    <div className='flex h-full w-full flex-col box-border'>
      <div className='flex shrink-0 items-center gap-12px border-b border-solid border-[var(--color-border-2)] px-16px py-10px'>
        <Button size='small' type='text' onClick={() => void navigate('/customer-service')}>
          <span className='inline-flex items-center gap-4px'>
            <Left theme='outline' size='14' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
            {t('customerService.stats.back', { defaultValue: '返回' })}
          </span>
        </Button>
        <span className='text-15px font-500'>
          {t('customerService.stats.title', { defaultValue: '统计报表' })}
        </span>
        <span className='text-12px text-t-tertiary'>
          {t('customerService.stats.subtitle', {
            defaultValue: '接了多少、多久响应、访客打几分。',
          })}
        </span>
        <span className='ml-auto flex items-center gap-6px'>
          <Button size='small' onClick={() => void load()} icon={<Refresh theme='outline' size='14' fill='currentColor' />}>
            {t('common.refresh', { defaultValue: '刷新' })}
          </Button>
          <Button size='small' loading={scanning} onClick={() => void runSlaScan()} icon={<Shield theme='outline' size='14' fill='currentColor' />}>
            {t('customerService.stats.scanSla', { defaultValue: '扫描 SLA' })}
          </Button>
        </span>
      </div>

      <div className='shrink-0 px-16px py-10px flex items-center gap-8px border-b border-solid border-[var(--color-border-2)]'>
        <Select value={agentFilter} onChange={(v) => setAgentFilter(v as CsAgentId | 'all')} style={{ width: '200px' }}>
          <Select.Option value='all'>
            {t('customerService.stats.filter.all', { defaultValue: '全部客服' })}
          </Select.Option>
          {agents.map((agent) => (
            <Select.Option key={agent.cs_agent_id} value={agent.cs_agent_id}>
              {agent.name}
            </Select.Option>
          ))}
        </Select>
        <Select value={range} onChange={(v) => setRange(v as RangeKey)} style={{ width: '140px' }}>
          {RANGES.map((r) => (
            <Select.Option key={r.key} value={r.key}>
              {t(`customerService.stats.range.${r.key}`, {
                defaultValue: { '24h': '近 24 小时', '7d': '近 7 天', '30d': '近 30 天', all: '全部' }[r.key],
              })}
            </Select.Option>
          ))}
        </Select>
      </div>

      <div className='grow min-h-0 overflow-y-auto px-16px py-16px'>
        {loading && !stats ? (
          <div className='flex h-full items-center justify-center'>
            <Spin />
          </div>
        ) : !stats || !derived ? (
          <Empty description={t('customerService.stats.empty', { defaultValue: '暂无统计数据' })} />
        ) : (
          <div className='flex flex-col gap-16px'>
            {/* 规模与人力成本 */}
            <div className='grid gap-12px' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
              <StatCard
                label={t('customerService.stats.dialogues', { defaultValue: '会话总数' })}
                value={stats.dialogues_total}
              />
              <StatCard
                label={t('customerService.stats.takenOver', { defaultValue: '转人工会话' })}
                value={stats.dialogues_taken_over}
                hint={t('customerService.stats.takeOverRate', {
                  defaultValue: '转人工率 {{rate}}',
                  rate: `${Math.round(derived.takeOverRate * 100)}%`,
                })}
              />
              <StatCard
                label={t('customerService.stats.ticketsOpen', { defaultValue: '未结工单' })}
                value={stats.tickets_open}
                tone={stats.tickets_open > 0 ? 'warn' : 'default'}
              />
              <StatCard
                label={t('customerService.stats.ticketsResolved', { defaultValue: '已解决工单' })}
                value={stats.tickets_resolved}
                tone='good'
              />
            </div>

            {/* SLA 履约 */}
            <div className='flex flex-col gap-10px'>
              <span className='text-13px font-600 text-t-primary'>
                {t('customerService.stats.slaSection', { defaultValue: 'SLA 履约' })}
              </span>
              <div className='grid gap-12px' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
                <StatCard
                  label={t('customerService.stats.avgFirstResponse', { defaultValue: '平均首次响应' })}
                  value={formatDuration(derived.avgFirstResponse)}
                  hint={t('customerService.stats.respondedCount', {
                    defaultValue: '{{count}} 条已响应',
                    count: stats.tickets_responded,
                  })}
                />
                <Tooltip
                  content={t('customerService.stats.slaRateHint', {
                    defaultValue: '已判定 SLA 的工单中，按时完成的占比',
                  })}
                >
                  <div>
                    <StatCard
                      label={t('customerService.stats.slaRate', { defaultValue: 'SLA 达成率' })}
                      value={derived.slaTotal > 0 ? `${Math.round(derived.slaRate * 100)}%` : '—'}
                      tone={derived.slaRate >= 0.9 ? 'good' : derived.slaRate >= 0.7 ? 'warn' : 'bad'}
                    />
                  </div>
                </Tooltip>
                <StatCard
                  label={t('customerService.stats.breached', { defaultValue: '超时工单' })}
                  value={stats.tickets_breached}
                  tone={stats.tickets_breached > 0 ? 'bad' : 'default'}
                />
                <StatCard
                  label={t('customerService.stats.escalated', { defaultValue: '已自动升级' })}
                  value={stats.tickets_escalated}
                  hint={t('customerService.stats.escalatedHint', {
                    defaultValue: '超时后自动提优先级',
                  })}
                />
              </div>
            </div>

            {/* 满意度 */}
            <div className='flex flex-col gap-10px'>
              <span className='inline-flex items-center gap-6px text-13px font-600 text-t-primary'>
                <ChartHistogram theme='outline' size='15' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
                {t('customerService.stats.csatSection', { defaultValue: '访客满意度' })}
              </span>
              {stats.ratings_count === 0 ? (
                <div className='rd-12px border border-dashed border-[var(--color-border-3)] px-16px py-20px text-center text-12px text-t-tertiary'>
                  {t('customerService.stats.noRatings', {
                    defaultValue: '还没有评价。访客在挂件里点「评价」即可打分。',
                  })}
                </div>
              ) : (
                <div className='flex flex-wrap items-end gap-16px rd-12px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] px-16px py-14px'>
                  <div className='flex flex-col gap-2px'>
                    <span className='text-12px text-t-tertiary'>
                      {t('customerService.stats.avgScore', { defaultValue: '平均评分' })}
                    </span>
                    <span className='text-28px font-700 leading-34px' style={{ color: 'var(--color-warning-6, #FF7D00)' }}>
                      {derived.avgScore.toFixed(2)}
                    </span>
                    <span className='text-11px text-t-tertiary'>
                      {t('customerService.stats.ratingCount', {
                        defaultValue: '共 {{count}} 条评价',
                        count: stats.ratings_count,
                      })}
                    </span>
                  </div>
                  <div className='flex flex-1 items-end gap-10px' style={{ minWidth: '220px' }}>
                    {[5, 4, 3, 2, 1].map((score) => {
                      const count = stats.ratings_histogram[score - 1] ?? 0;
                      const height = Math.max(4, Math.round((count / derived.maxBar) * 72));
                      return (
                        <div key={score} className='flex flex-1 flex-col items-center gap-4px' style={{ minWidth: '32px' }}>
                          <span className='text-11px text-t-tertiary'>{count}</span>
                          <div
                            className='w-full rd-4px'
                            style={{
                              height: `${height}px`,
                              background:
                                score >= 4
                                  ? 'var(--color-success-6, #00B42A)'
                                  : score === 3
                                    ? 'var(--color-warning-6, #FF7D00)'
                                    : 'var(--color-danger-6, #F53F3F)',
                              opacity: count === 0 ? 0.25 : 1,
                            }}
                          />
                          <span className='text-11px text-t-tertiary'>{score}★</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 最近评价原文 */}
            {ratings.length > 0 && (
              <div className='flex flex-col gap-10px'>
                <span className='text-13px font-600 text-t-primary'>
                  {t('customerService.stats.recentRatings', { defaultValue: '最近评价' })}
                </span>
                <div className='flex flex-col gap-8px'>
                  {ratings.map((rating) => (
                    <div
                      key={rating.cs_rating_id}
                      className='flex flex-col gap-4px rd-10px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] px-14px py-10px'
                    >
                      <div className='flex items-center gap-8px'>
                        <span className='text-13px' style={{ color: 'var(--color-warning-6, #FF7D00)' }}>
                          {'★'.repeat(rating.score)}
                          <span className='text-[var(--color-text-4)]'>{'★'.repeat(5 - rating.score)}</span>
                        </span>
                        <Tag size='small' color='arcoblue'>
                          {agentName(rating.cs_agent_id)}
                        </Tag>
                        <span className='ml-auto text-11px text-t-tertiary'>{formatTime(rating.created_at)}</span>
                      </div>
                      {rating.comment ? (
                        <span className='text-12px text-t-secondary leading-18px'>{rating.comment}</span>
                      ) : (
                        <span className='text-12px text-t-tertiary'>
                          {t('customerService.stats.noComment', { defaultValue: '（未填写评价内容）' })}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CsStatsPage;
