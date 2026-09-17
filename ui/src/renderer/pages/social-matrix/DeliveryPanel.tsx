/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Button, Empty, Tag, Tooltip } from '@arco-design/web-react';
import { Down, Link, Up } from '@icon-park/react';
import classNames from 'classnames';
import { DeliveryIcon, PlatformBadge } from './PlatformBadge';
import { displayText, deliverySummary } from './useSocialMatrix';
import type { SocialPost } from './types';

interface DeliveryPanelProps {
  deliveredPosts: SocialPost[];
}

const STATUS_META: Record<
  string,
  { label: string; color: 'green' | 'orange' | 'red' | 'gray' | 'blue' }
> = {
  published: { label: '全部成功', color: 'green' },
  partial: { label: '部分成功', color: 'orange' },
  failed: { label: '全部失败', color: 'red' },
  publishing: { label: '投递中', color: 'blue' },
  scheduled: { label: '已排期', color: 'gray' },
  draft: { label: '草稿', color: 'gray' },
};

/**
 * DeliveryPanel — 发布记录。
 *
 * 这一页的价值在于**逐平台的失败原因是分开留存的**（对应上游
 * `post_accounts` 中间表的 `errors` 字段）：一条内容投 6 个平台，4 个成功
 * 2 个失败时，失败的那两条各自带着平台原始报错，而不是整条内容标记为失败。
 * 排查 Facebook 授权、Instagram 缺图这类问题时，报错原文比翻译过的提示有用得多。
 */
const DeliveryPanel: React.FC<DeliveryPanelProps> = ({ deliveredPosts }) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const totalFailures = useMemo(
    () =>
      deliveredPosts.reduce(
        (sum, post) => sum + post.targets.filter((t) => t.status === 'failed').length,
        0
      ),
    [deliveredPosts]
  );

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (deliveredPosts.length === 0) {
    return (
      <div className='box-border rounded-8px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-24px'>
        <Empty description='还没有投递记录' />
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-10px'>
      {totalFailures > 0 && (
        <div className='box-border rounded-6px bg-[#fff1f0] px-12px py-8px text-12px text-[#f53f3f]'>
          共有 {totalFailures} 个平台投递失败，展开对应记录可查看平台返回的原始错误。
        </div>
      )}

      {deliveredPosts.map((post) => {
        const summary = deliverySummary(post);
        const meta = STATUS_META[post.status] ?? STATUS_META.draft;
        const isOpen = expanded.has(post.id);
        const when = post.publishedAt ?? post.createdAt;

        return (
          <div
            key={post.id}
            className='box-border rounded-8px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-12px'
          >
            <div className='flex items-start gap-10px'>
              <div className='flex flex-col items-center shrink-0 pt-1px'>
                <span className='text-12px font-[600] text-t-primary'>
                  {new Date(when).toLocaleDateString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                  })}
                </span>
                <span className='text-11px text-t-tertiary'>
                  {new Date(when).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>

              <div className='flex flex-col gap-6px min-w-0 flex-1'>
                <div className='flex flex-wrap items-center gap-6px'>
                  <Tag size='small' color={meta.color}>
                    {meta.label}
                  </Tag>
                  <Tag size='small' color='green'>
                    {summary.success} 成功
                  </Tag>
                  {summary.failed > 0 && (
                    <Tag size='small' color='red'>
                      {summary.failed} 失败
                    </Tag>
                  )}
                  {summary.pending > 0 && (
                    <Tag size='small' color='gray'>
                      {summary.pending} 待定
                    </Tag>
                  )}
                  {post.campaign && <Tag size='small'>{post.campaign}</Tag>}
                </div>

                <span className='text-12px leading-18px text-t-secondary line-clamp-2'>
                  {displayText(post).slice(0, 180) || '（无文案）'}
                </span>
              </div>

              <Button
                size='mini'
                type='text'
                icon={
                  isOpen ? (
                    <Up theme='outline' size={13} />
                  ) : (
                    <Down theme='outline' size={13} />
                  )
                }
                onClick={() => toggle(post.id)}
              >
                {isOpen ? '收起' : '逐平台明细'}
              </Button>
            </div>

            {isOpen && (
              <div className='mt-10px flex flex-col gap-6px border-t border-solid border-[var(--color-border-2)] pt-10px'>
                {post.targets.length === 0 && (
                  <span className='text-12px text-t-tertiary'>该记录没有逐平台结果。</span>
                )}
                {post.targets.map((target, index) => (
                  <div
                    key={`${target.accountId}-${target.targetId ?? index}`}
                    className={classNames(
                      'flex items-start gap-8px box-border rounded-6px px-10px py-8px',
                      target.status === 'failed' ? 'bg-[#fff1f0]' : 'bg-[var(--color-fill-1)]'
                    )}
                  >
                    <PlatformBadge platform={target.platform} size='sm' />
                    <DeliveryIcon status={target.status} />
                    <div className='flex flex-col gap-2px min-w-0 flex-1'>
                      <span className='text-12px text-t-primary'>
                        {target.targetName ?? target.accountId}
                      </span>
                      {target.error && (
                        <span className='text-11px leading-16px text-[#f53f3f] break-all'>
                          {target.error}
                        </span>
                      )}
                      {target.providerPostId && !target.error && (
                        <span className='text-11px text-t-tertiary'>
                          平台帖子 ID：{target.providerPostId}
                        </span>
                      )}
                    </div>
                    {target.permalink && (
                      <Tooltip content='打开平台上的帖子' position='top'>
                        <Button
                          size='mini'
                          type='text'
                          icon={<Link theme='outline' size={13} />}
                          onClick={() =>
                            window.open(target.permalink as string, '_blank', 'noopener,noreferrer')
                          }
                        />
                      </Tooltip>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default DeliveryPanel;
