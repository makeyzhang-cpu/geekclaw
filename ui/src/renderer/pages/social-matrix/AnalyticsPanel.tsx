/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Empty, Tag } from '@arco-design/web-react';
import { Analysis, ChartHistogram } from '@icon-park/react';
import classNames from 'classnames';
import { PlatformBadge } from './PlatformBadge';
import { platformSpec } from './platforms';
import type { SocialPlatformMetrics } from './types';

interface AnalyticsPanelProps {
  metricsByPlatform: SocialPlatformMetrics[];
  /** 还没有任何账号连接时，这页要给出「先连账号」而不是「没有数据」。 */
  hasAccounts: boolean;
}

const formatNumber = (n: number): string => {
  if (!Number.isFinite(n) || n === 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

const formatRate = (rate: number | null): string =>
  rate === null ? '—' : `${(rate * 100).toFixed(2)}%`;

/**
 * AnalyticsPanel — 数据看板。
 *
 * 指标由服务端定时回收（对应上游的 analytics collector）：发布后按目标拉取
 * 曝光、点赞、评论、分享，按 (账号, 平台帖子 ID) 归档。这里只做聚合展示——
 * **每个帖子取最新一次采样**，不是把历史采样累加，否则同一帖会被重复计数。
 *
 * 互动率 =（点赞 + 评论 + 分享）/ 曝光；平台不返回曝光时显示「—」而不是 0%，
 * 因为「没有曝光数据」和「有曝光但零互动」是两回事。
 */
const AnalyticsPanel: React.FC<AnalyticsPanelProps> = ({ metricsByPlatform, hasAccounts }) => {
  const totals = useMemo(() => {
    const acc = {
      posts: 0,
      impressions: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      views: 0,
    };
    for (const m of metricsByPlatform) {
      acc.posts += m.posts;
      acc.impressions += m.impressions;
      acc.likes += m.likes;
      acc.comments += m.comments;
      acc.shares += m.shares;
      acc.views += m.views;
    }
    const engagement = acc.likes + acc.comments + acc.shares;
    return {
      ...acc,
      engagement,
      rate: acc.impressions > 0 ? engagement / acc.impressions : null,
    };
  }, [metricsByPlatform]);

  const active = metricsByPlatform.filter((m) => m.posts > 0);
  const maxImpressions = Math.max(1, ...metricsByPlatform.map((m) => m.impressions));

  if (!hasAccounts) {
    return (
      <div className='box-border rounded-8px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-24px'>
        <Empty description='还没有连接任何社媒账号——先在「账号矩阵」完成授权，指标会在发布后自动回收' />
      </div>
    );
  }

  if (active.length === 0) {
    return (
      <div className='box-border rounded-8px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-24px'>
        <Empty description='账号已连接，但还没有可回收的指标——发布内容后由服务端定时采集' />
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-16px'>
      {/* 汇总 */}
      <div className='grid grid-cols-2 md:grid-cols-4 gap-10px'>
        {[
          { label: '已回收指标的内容', value: formatNumber(totals.posts), unit: '条' },
          { label: '总曝光', value: formatNumber(totals.impressions) },
          { label: '总互动', value: formatNumber(totals.engagement) },
          { label: '平均互动率', value: formatRate(totals.rate) },
        ].map((card) => (
          <div
            key={card.label}
            className='box-border rounded-8px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] px-14px py-12px'
          >
            <div className='text-11px text-t-tertiary mb-6px'>{card.label}</div>
            <div className='text-22px font-[600] leading-26px text-t-primary'>
              {card.value}
              {card.unit && (
                <span className='ml-4px text-12px font-[400] text-t-tertiary'>{card.unit}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 分平台明细 */}
      <div className='box-border rounded-8px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-12px'>
        <div className='mb-12px flex items-center gap-8px'>
          <Analysis theme='outline' size={15} />
          <span className='text-13px font-[600] text-t-primary'>分平台表现</span>
          <span className='text-11px text-t-tertiary'>按曝光量排序</span>
        </div>

        <div className='flex flex-col gap-12px'>
          {[...metricsByPlatform]
            .filter((m) => m.posts > 0)
            .sort((a, b) => b.impressions - a.impressions)
            .map((m) => {
              const spec = platformSpec(m.platform);
              const ratio = m.impressions / maxImpressions;
              return (
                <div key={m.platform} className='flex items-center gap-12px'>
                  <div className='flex items-center gap-6px shrink-0' style={{ width: 128 }}>
                    <PlatformBadge platform={m.platform} size='sm' />
                    <span className='text-12px text-t-primary'>{spec.label}</span>
                  </div>

                  {/* 曝光对比条 */}
                  <div className='flex-1 h-18px rounded-4px bg-[var(--color-fill-1)] overflow-hidden'>
                    <div
                      className='h-full rounded-4px transition-all'
                      style={{
                        width: `${Math.max(2, ratio * 100)}%`,
                        background: spec.color,
                        opacity: 0.85,
                      }}
                    />
                  </div>

                  <div className='flex items-center gap-10px shrink-0' style={{ width: 300 }}>
                    <span className='text-12px text-t-primary' style={{ width: 70 }}>
                      {formatNumber(m.impressions)}
                    </span>
                    <span className='text-11px text-t-tertiary' style={{ width: 88 }}>
                      赞 {formatNumber(m.likes)}
                    </span>
                    <span className='text-11px text-t-tertiary' style={{ width: 88 }}>
                      评 {formatNumber(m.comments)}
                    </span>
                    <span
                      className={classNames(
                        'text-11px',
                        m.engagementRate !== null && m.engagementRate >= 0.02
                          ? 'text-[#00b42a]'
                          : 'text-t-tertiary'
                      )}
                    >
                      {formatRate(m.engagementRate)}
                    </span>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* 说明 */}
      <div className='box-border rounded-8px border border-dashed border-[var(--color-border-2)] px-14px py-12px'>
        <div className='mb-6px flex items-center gap-6px text-12px font-[600] text-t-secondary'>
          <ChartHistogram theme='outline' size={14} />
          指标口径
        </div>
        <div className='text-11px leading-18px text-t-tertiary'>
          · 每条内容按「账号 + 平台帖子 ID」归档，图表取**最新一次采样**，不累加历史； <br />
          · 互动率 =（点赞 + 评论 + 分享）/ 曝光；平台不返回曝光时显示「—」； <br />
          · 采集频率与各平台指标接口的可用性有关，部分平台不返回曝光或播放量属正常。
        </div>
      </div>
    </div>
  );
};

export default AnalyticsPanel;
