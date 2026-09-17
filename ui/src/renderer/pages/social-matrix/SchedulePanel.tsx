/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Button, Empty, Message, Popconfirm, Tag, Tooltip } from '@arco-design/web-react';
import { Delete, Export, Left, Right, Send, Time } from '@icon-park/react';
import classNames from 'classnames';
import { PlatformBadge } from './PlatformBadge';
import { cancelSchedule, deletePost, publishPostNow } from './cloudApi';
import { displayText } from './useSocialMatrix';
import type { SocialPost, SocialPlatform } from './types';

interface SchedulePanelProps {
  scheduledPosts: SocialPost[];
  drafts: SocialPost[];
  demo: boolean;
  reload: () => void | Promise<void>;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

const formatTime = (ts: number) =>
  new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * 生成月历网格（周一起始，固定 6 行 × 7 列，避免行数变化导致布局跳动）。
 */
function buildMonthGrid(year: number, month: number): { date: Date; inMonth: boolean }[] {
  const first = new Date(year, month, 1);
  // getDay(): 0=周日 … 6=周六。转成周一起始的偏移量。
  const offset = (first.getDay() + 6) % 7;
  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(year, month, 1 - offset + i);
    cells.push({ date, inMonth: date.getMonth() === month });
  }
  return cells;
}

/** 某条内容要投递到哪些平台（优先看声明版本，再看已有目标）。 */
function postPlatforms(post: SocialPost): SocialPlatform[] {
  const set = new Set<SocialPlatform>();
  for (const v of post.versions) set.add(v.platform);
  for (const t of post.targets) set.add(t.platform);
  return [...set];
}

/**
 * SchedulePanel — 排期日历 + 队列。
 *
 * 月历只做「哪几天有内容待发」的密度展示，真正的操作集中在下方队列里——
 * 日历格子里塞太多交互反而不好点。
 */
const SchedulePanel: React.FC<SchedulePanelProps> = ({
  scheduledPosts,
  drafts,
  demo,
  reload,
}) => {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [busyId, setBusyId] = useState<string | null>(null);

  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor]);

  const byDay = useMemo(() => {
    const map = new Map<number, SocialPost[]>();
    for (const post of scheduledPosts) {
      if (typeof post.scheduledAt !== 'number') continue;
      const key = startOfDay(new Date(post.scheduledAt));
      const list = map.get(key) ?? [];
      list.push(post);
      map.set(key, list);
    }
    return map;
  }, [scheduledPosts]);

  const shiftMonth = useCallback((delta: number) => {
    setCursor((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }, []);

  const run = useCallback(
    async (id: string, action: () => Promise<unknown>, okText: string) => {
      setBusyId(id);
      try {
        await action();
        Message.success(okText);
        await reload();
      } catch (error) {
        console.error('[social-matrix] schedule action failed', error);
        Message.error('操作失败，请稍后重试。');
      } finally {
        setBusyId(null);
      }
    },
    [reload]
  );

  const todayStart = startOfDay(today);

  return (
    <div className='flex flex-col gap-16px'>
      {/* 月历 */}
      <div className='box-border rounded-8px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-12px'>
        <div className='mb-10px flex items-center gap-10px'>
          <Button
            size='mini'
            type='text'
            icon={<Left theme='outline' size={14} />}
            onClick={() => shiftMonth(-1)}
          />
          <span className='text-14px font-[600] text-t-primary'>
            {cursor.year} 年 {cursor.month + 1} 月
          </span>
          <Button
            size='mini'
            type='text'
            icon={<Right theme='outline' size={14} />}
            onClick={() => shiftMonth(1)}
          />
          <Button
            size='mini'
            onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}
          >
            回到本月
          </Button>
          <div className='flex-1' />
          <span className='text-12px text-t-tertiary'>
            本月排期 {scheduledPosts.filter((p) => {
              if (typeof p.scheduledAt !== 'number') return false;
              const d = new Date(p.scheduledAt);
              return d.getFullYear() === cursor.year && d.getMonth() === cursor.month;
            }).length}{' '}
            条
          </span>
        </div>

        <div className='grid grid-cols-7 gap-4px mb-4px'>
          {WEEKDAYS.map((w) => (
            <div key={w} className='text-center text-11px text-t-tertiary py-4px'>
              {w}
            </div>
          ))}
        </div>

        <div className='grid grid-cols-7 gap-4px'>
          {grid.map(({ date, inMonth }, index) => {
            const key = startOfDay(date);
            const posts = byDay.get(key) ?? [];
            const isToday = key === todayStart;
            return (
              <div
                key={index}
                className={classNames(
                  'box-border min-h-64px rounded-6px border border-solid p-4px flex flex-col gap-2px',
                  inMonth
                    ? 'border-[var(--color-border-2)] bg-[var(--color-bg-2)]'
                    : 'border-transparent bg-[var(--color-fill-1)] opacity-50',
                  isToday && 'border-[var(--color-primary-6)]'
                )}
              >
                <span
                  className={classNames(
                    'text-11px leading-14px',
                    isToday ? 'text-[var(--color-primary-6)] font-[600]' : 'text-t-tertiary'
                  )}
                >
                  {date.getDate()}
                </span>
                {posts.slice(0, 2).map((post) => (
                  <Tooltip
                    key={post.id}
                    position='top'
                    content={
                      <div className='max-w-280px'>
                        <div className='mb-4px'>{formatTime(post.scheduledAt ?? 0)}</div>
                        <div className='text-11px opacity-80'>
                          {displayText(post).slice(0, 80) || '（无文案）'}
                        </div>
                      </div>
                    }
                  >
                    <div className='flex items-center gap-3px rounded-3px bg-[var(--color-fill-1)] px-3px py-2px cursor-default'>
                      {postPlatforms(post)
                        .slice(0, 3)
                        .map((p) => (
                          <PlatformBadge key={p} platform={p} size='sm' />
                        ))}
                      <span className='text-10px text-t-tertiary truncate'>
                        {new Date(post.scheduledAt ?? 0).toLocaleTimeString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </Tooltip>
                ))}
                {posts.length > 2 && (
                  <span className='text-10px text-t-tertiary'>+{posts.length - 2}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 队列 */}
      <div className='box-border rounded-8px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-12px'>
        <div className='mb-10px flex items-center gap-8px'>
          <Time theme='outline' size={15} />
          <span className='text-13px font-[600] text-t-primary'>待发队列</span>
          <span className='text-12px text-t-tertiary'>{scheduledPosts.length} 条</span>
        </div>

        {scheduledPosts.length === 0 ? (
          <Empty description='队列为空——去「内容创作」新建一条并加入排期' />
        ) : (
          <div className='flex flex-col gap-8px'>
            {scheduledPosts.map((post) => (
              <div
                key={post.id}
                className='flex items-start gap-10px box-border rounded-6px bg-[var(--color-fill-1)] px-12px py-10px'
              >
                <div className='flex flex-col items-center shrink-0 pt-2px'>
                  <span className='text-12px font-[600] text-t-primary'>
                    {new Date(post.scheduledAt ?? 0).toLocaleDateString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                    })}
                  </span>
                  <span className='text-11px text-t-tertiary'>
                    {new Date(post.scheduledAt ?? 0).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                <div className='flex flex-col gap-4px min-w-0 flex-1'>
                  <div className='flex items-center gap-4px'>
                    {postPlatforms(post).map((p) => (
                      <PlatformBadge key={p} platform={p} size='sm' />
                    ))}
                    {post.campaign && <Tag size='small'>{post.campaign}</Tag>}
                  </div>
                  <span className='text-12px leading-18px text-t-secondary line-clamp-2'>
                    {displayText(post).slice(0, 140) || '（无文案）'}
                  </span>
                </div>

                <div className='flex items-center gap-6px shrink-0'>
                  <Button
                    size='mini'
                    icon={<Send theme='outline' size={13} />}
                    loading={busyId === post.id}
                    disabled={demo}
                    onClick={() =>
                      void run(post.id, () => publishPostNow(post.id), '已提交立即发布')
                    }
                  >
                    立即发
                  </Button>
                  <Button
                    size='mini'
                    icon={<Export theme='outline' size={13} />}
                    loading={busyId === post.id}
                    disabled={demo}
                    onClick={() =>
                      void run(post.id, () => cancelSchedule(post.id), '已撤销排期')
                    }
                  >
                    撤销
                  </Button>
                  <Popconfirm
                    title='删除这条内容？'
                    okText='删除'
                    cancelText='取消'
                    disabled={demo}
                    onOk={() => void run(post.id, () => deletePost(post.id), '已删除')}
                  >
                    <Button
                      size='mini'
                      type='text'
                      status='danger'
                      icon={<Delete theme='outline' size={13} />}
                      disabled={demo}
                    />
                  </Popconfirm>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 草稿 */}
        {drafts.length > 0 && (
          <div className='mt-14px'>
            <div className='mb-8px text-12px text-t-tertiary'>草稿（{drafts.length}）</div>
            <div className='flex flex-col gap-6px'>
              {drafts.map((post) => (
                <div
                  key={post.id}
                  className='flex items-center gap-10px box-border rounded-6px border border-dashed border-[var(--color-border-2)] px-12px py-8px'
                >
                  <span className='text-12px text-t-secondary truncate flex-1'>
                    {displayText(post).slice(0, 100) || '（空白草稿）'}
                  </span>
                  <Popconfirm
                    title='删除这条草稿？'
                    okText='删除'
                    cancelText='取消'
                    disabled={demo}
                    onOk={() => void run(post.id, () => deletePost(post.id), '已删除')}
                  >
                    <Button
                      size='mini'
                      type='text'
                      status='danger'
                      icon={<Delete theme='outline' size={13} />}
                      disabled={demo}
                    />
                  </Popconfirm>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SchedulePanel;
