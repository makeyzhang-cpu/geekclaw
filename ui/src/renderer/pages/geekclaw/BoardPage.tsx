/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Drawer, Message, Spin, Tag } from '@arco-design/web-react';
import classNames from 'classnames';
import HubPageShell from '@renderer/components/layout/HubPageShell';
import { BoardData, BoardMember, loadBoardExperts } from '@renderer/data/expertsData';
import { BOARD_KEY_PREFIX, hireLocalExpert, liveHires, stripPrefix } from './localExpertCompanions';
import type { ICompanionWithStatus } from '@/common/adapter/ipcBridge';
import type { CompanionId } from '@/common/types/ids';

const PRESET_COLORS = [
  'bg-[rgba(99,102,241,0.16)] text-[rgb(99,102,241)]',
  'bg-[rgba(236,72,153,0.16)] text-[rgb(236,72,153)]',
  'bg-[rgba(16,185,129,0.16)] text-[rgb(16,185,129)]',
  'bg-[rgba(245,158,11,0.16)] text-[rgb(245,158,11)]',
  'bg-[rgba(59,130,246,0.16)] text-[rgb(59,130,246)]',
  'bg-[rgba(139,92,246,0.16)] text-[rgb(139,92,246)]',
];

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PRESET_COLORS[h % PRESET_COLORS.length];
}

const BoardAvatar: React.FC<{ name: string; size?: number }> = ({ name, size = 44 }) => (
  <span
    style={{ width: size, height: size, fontSize: size * 0.42 }}
    className={classNames(
      'rounded-full flex items-center justify-center font-700 shrink-0',
      colorFor(name)
    )}
  >
    {name.slice(0, 1)}
  </span>
);

const MemberCard: React.FC<{
  member: BoardMember;
  pending: boolean;
  hired: boolean;
  onOpen: (member: BoardMember) => void;
  onHire: (member: BoardMember) => void;
}> = ({ member, pending, hired, onOpen, onHire }) => (
  <div
    role='button'
    tabIndex={0}
    onClick={() => onOpen(member)}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen(member);
      }
    }}
    className='group relative flex flex-col gap-10px p-16px rd-12px border border-solid border-[var(--color-border-2)] bg-fill-1 hover:border-primary-6 hover:shadow-sm transition-all cursor-pointer outline-none'
  >
    <div className='flex items-start gap-10px'>
      <BoardAvatar name={member.name} size={44} />
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-6px'>
          <span className='text-15px font-600 text-t-primary leading-20px truncate'>{member.name}</span>
          {hired && (
            <Tag size='small' color='green' className='shrink-0'>
              已在席
            </Tag>
          )}
        </div>
        <div className='text-12px leading-16px text-t-tertiary mt-2px truncate'>{member.group}</div>
      </div>
    </div>
    <p className='text-13px leading-18px text-t-tertiary m-0 line-clamp-2 min-h-36px'>
      {member.tagline || member.description || '—'}
    </p>
    <div className='flex items-center justify-between mt-2px pt-2px'>
      <span className='text-12px text-t-tertiary'>落座即开对话</span>
      <Button
        type={hired ? 'secondary' : 'primary'}
        size='mini'
        loading={pending}
        onClick={(e) => {
          e.stopPropagation();
          onHire(member);
        }}
      >
        {hired ? '入席对话' : '邀请入席'}
      </Button>
    </div>
  </div>
);

export interface BoardPageProps {
  /** 当前数字员工名册（判定已登记的 companion 是否仍在）。 */
  roster: ICompanionWithStatus[];
  /** 雇佣成功后打开该员工的对话（页内切换，由页面负责）。 */
  onHired: (companionId: CompanionId) => void | Promise<void>;
}

/**
 * 分身专家董事会 —— 依「分身专家董事会」技能包落地。
 *
 * 主席台（expert-council）+ 13 位董事（达利欧 / 芒格 / 贝索斯 / 马斯克 …）+ 3 个
 * A4 文书技能。点击任一席位即以该人设落座开对话：本地建一个数字员工，把该
 * 人格写进 `persona.custom`，然后**在本页内**切到它的对话（不跳 /conversation）。
 */
const BoardPage: React.FC<BoardPageProps> = ({ roster, onHired }) => {
  const { t } = useTranslation();
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BoardMember | null>(null);
  /** 已在本名册中的员工对应的人设（用于「已在席」标记），key = 专家 id。 */
  const [hiredIds, setHiredIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const d = await loadBoardExperts();
        if (!cancelled) setData(d);
      } catch (err) {
        Message.error(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 台账 ∩ 现役名册 = 「已在席」。员工被删掉后这里会自动取消标记。
  useEffect(() => {
    if (!data) return;
    const ids = new Set<string>();
    for (const { key } of liveHires(roster, BOARD_KEY_PREFIX)) ids.add(stripPrefix(key));
    setHiredIds(ids);
  }, [data, roster]);

  const hire = useCallback(
    async (member: BoardMember) => {
      if (pendingId) return;
      setPendingId(member.id);
      try {
        const companionId = await hireLocalExpert({
          key: `${BOARD_KEY_PREFIX}${member.id}`,
          name: member.name,
          subtitle: member.group,
          source: 'board',
          persona: member.persona,
          roster,
        });
        setDetail(null);
        await onHired(companionId);
      } catch (err) {
        Message.error(String(err));
      } finally {
        setPendingId(null);
      }
    },
    [onHired, pendingId, roster]
  );

  const grouped = useMemo(() => {
    if (!data) return [] as Array<{ group: string; members: BoardMember[] }>;
    const order: string[] = [];
    const bucket = new Map<string, BoardMember[]>();
    for (const m of data.members) {
      if (!bucket.has(m.group)) {
        bucket.set(m.group, []);
        order.push(m.group);
      }
      bucket.get(m.group)!.push(m);
    }
    return order.map((group) => ({ group, members: bucket.get(group)! }));
  }, [data]);

  if (loading) {
    return (
      <div className='flex-1 flex items-center justify-center py-60px'>
        <Spin />
      </div>
    );
  }

  if (!data) return null;

  return (
    <HubPageShell
      title={t('expertMarket.boardTitle', { defaultValue: '分身专家董事会' })}
      subtitle={t('expertMarket.boardSubtitle', {
        defaultValue: '召集多位顶尖思维者同席会诊 —— 一位主席主持，按议题自动点将，输出结论与行动项。',
      })}
    >
      {/* 主席台 */}
      <div className='mb-24px rounded-12px border border-solid border-[var(--color-border-2)] bg-[rgba(99,102,241,0.06)] p-20px box-border'>
        <div className='flex items-start gap-14px'>
          <BoardAvatar name={data.council.name} size={52} />
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-8px flex-wrap'>
              <span className='text-17px font-700 text-t-primary'>{data.council.name}</span>
              <Tag size='small' color='arcoblue'>
                主席台
              </Tag>
            </div>
            <p className='text-13px leading-20px text-t-secondary mt-6px mb-0'>
              {data.council.tagline || data.council.description}
            </p>
            <div className='mt-12px flex items-center gap-10px'>
              <Button
                type='primary'
                size='small'
                loading={pendingId === data.council.id}
                onClick={() => void hire(data.council)}
              >
                {t('expertMarket.boardConvene', { defaultValue: '召开董事会' })}
              </Button>
              <Button size='small' onClick={() => setDetail(data.council)}>
                {t('expertMarket.boardViewPersona', { defaultValue: '查看设定' })}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 董事席位 */}
      <div className='text-14px font-600 text-t-primary mb-10px'>
        {t('expertMarket.boardMembers', { defaultValue: '董事会成员' })}
        <span className='text-12px font-400 text-t-tertiary ml-8px'>共 {data.members.length} 位</span>
      </div>
      {grouped.map(({ group, members }) => (
        <div key={group} className='mb-20px'>
          <div className='text-12px font-600 text-t-tertiary mb-8px'>{group}</div>
          <div className='grid gap-14px grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
            {members.map((m) => (
              <MemberCard
                key={m.id}
                member={m}
                pending={pendingId === m.id}
                hired={hiredIds.has(m.id)}
                onOpen={setDetail}
                onHire={(x) => void hire(x)}
              />
            ))}
          </div>
        </div>
      ))}

      {/* 文书技能 */}
      <div className='text-14px font-600 text-t-primary mb-10px mt-4px'>
        {t('expertMarket.boardTools', { defaultValue: '董事会文书' })}
        <span className='text-12px font-400 text-t-tertiary ml-8px'>
          把会诊结论落成可直接交付的 A4 文档
        </span>
      </div>
      <div className='grid gap-14px grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'>
        {data.tools.map((tool) => (
          <MemberCard
            key={tool.id}
            member={tool}
            pending={pendingId === tool.id}
            hired={hiredIds.has(tool.id)}
            onOpen={setDetail}
            onHire={(x) => void hire(x)}
          />
        ))}
      </div>

      {/* 人设抽屉 */}
      <Drawer
        width={420}
        title={detail?.name ?? ''}
        visible={detail !== null}
        onCancel={() => setDetail(null)}
        footer={
          detail && (
            <Button
              type='primary'
              loading={pendingId === detail.id}
              onClick={() => void hire(detail)}
            >
              {hiredIds.has(detail.id)
                ? t('expertMarket.boardResume', { defaultValue: '继续对话' })
                : t('expertMarket.boardTakeSeat', { defaultValue: '邀请入席' })}
            </Button>
          )
        }
      >
        {detail && (
          <div className='flex flex-col gap-14px'>
            <div className='flex items-center gap-12px'>
              <BoardAvatar name={detail.name} size={52} />
              <div>
                <div className='text-16px font-700 text-t-primary'>{detail.name}</div>
                <div className='text-12px text-t-tertiary mt-2px'>{detail.group}</div>
              </div>
            </div>
            {detail.description && (
              <p className='text-13px leading-20px text-t-secondary m-0 whitespace-pre-wrap'>
                {detail.description}
              </p>
            )}
            <div className='rounded-lg bg-fill-2 p-12px'>
              <div className='text-13px font-600 text-t-secondary mb-6px'>人格设定</div>
              <p className='text-12px leading-18px text-t-tertiary m-0 whitespace-pre-wrap max-h-260px overflow-y-auto'>
                {detail.persona}
              </p>
            </div>
          </div>
        )}
      </Drawer>
    </HubPageShell>
  );
};

export default BoardPage;
