/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Drawer, Empty, Input, Message, Select, Spin, Tabs, Tag } from '@arco-design/web-react';
import { Plus, Search, Shop } from '@icon-park/react';
import classNames from 'classnames';
import HubPageShell from '@renderer/components/layout/HubPageShell';
import {
  ProfessionalExpert,
  loadProfessionalExperts,
  matchesQuery,
} from '@renderer/data/expertsData';
import {
  MARKET_KEY_PREFIX,
  hireLocalExpert,
  liveHires,
} from '@renderer/pages/geekclaw/localExpertCompanions';
import { useCompanions } from '@renderer/pages/geekclaw/useNomi';
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

/** 专家头像：本地专家无头像资源，统一用首字彩色圆。 */
const ExpertAvatar: React.FC<{ name: string; size?: number }> = ({ name, size = 44 }) => (
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

interface ExpertCardProps {
  expert: ProfessionalExpert;
  hired: boolean;
  pending: boolean;
  onOpen: (expert: ProfessionalExpert) => void;
  onHire: (expert: ProfessionalExpert) => void;
}

const ExpertCard: React.FC<ExpertCardProps> = ({ expert, hired, pending, onOpen, onHire }) => (
  <div
    role='button'
    tabIndex={0}
    onClick={() => onOpen(expert)}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen(expert);
      }
    }}
    className='group relative flex flex-col gap-10px p-16px rd-12px border border-solid border-[var(--color-border-2)] bg-fill-1 hover:border-primary-6 hover:shadow-sm transition-all cursor-pointer outline-none'
  >
    <div className='flex items-start gap-10px'>
      <ExpertAvatar name={expert.name} size={44} />
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-6px'>
          <span className='text-15px font-600 text-t-primary leading-20px truncate'>{expert.name}</span>
          {hired && (
            <Tag size='small' color='green' className='shrink-0'>
              已雇佣
            </Tag>
          )}
        </div>
        <div className='text-12px leading-16px text-t-tertiary mt-2px truncate'>{expert.title}</div>
      </div>
    </div>

    <p className='text-13px leading-18px text-t-tertiary m-0 line-clamp-2 min-h-36px'>
      {expert.tagline || expert.description || '—'}
    </p>

    <div className='flex items-center justify-between mt-2px pt-2px'>
      <span className='px-8px py-2px rd-6px bg-[rgba(16,185,129,0.14)] text-12px text-[rgb(16,185,129)] font-600'>
        内置 · 免费
      </span>
      <Button
        type={hired ? 'secondary' : 'primary'}
        size='mini'
        loading={pending}
        onClick={(e) => {
          e.stopPropagation();
          onHire(expert);
        }}
      >
        {hired ? '打开分身' : '雇佣'}
      </Button>
    </div>
  </div>
);

export interface ExpertMarketPageProps {
  /** 现役名册 —— 幂等判定 + 「我的专家」筛选用。缺省时自取。 */
  roster?: ICompanionWithStatus[];
  /** 雇佣成功后刷新名册（由页面提供，保证侧栏同步）。 */
  onRefreshRoster?: () => Promise<void>;
  /** 雇佣成功后打开该员工的对话（页内切换）。缺省时退回路由跳转。 */
  onHired?: (companionId: CompanionId) => void | Promise<void>;
}

/**
 * 专家数字分身市场 —— 目录**完全内置**（165 位专业专家 / 18 分类），
 * 不再依赖云端 `/api/experts/*`，也不需要「同步云端专家」。
 *
 * 雇佣 = 本地创建一个数字员工，把人设写进 `persona.custom`
 * （见 `localExpertCompanions.ts`），随后就地打开它的对话。
 */
const ExpertMarketPage: React.FC<ExpertMarketPageProps> = ({ roster, onRefreshRoster, onHired }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const internal = useCompanions();
  const liveRoster = roster ?? internal.companions;
  const refreshRoster = onRefreshRoster ?? internal.refresh;

  const [tab, setTab] = useState<'builtin' | 'mine'>('builtin');
  const [loading, setLoading] = useState(true);
  const [experts, setExperts] = useState<ProfessionalExpert[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string; count: number }>>([]);

  const [category, setCategory] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');

  const [detail, setDetail] = useState<ProfessionalExpert | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  /** 已雇佣（台账 ∩ 名册）的专家 id。 */
  const [hiredIds, setHiredIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await loadProfessionalExperts();
        if (cancelled) return;
        setExperts(data.experts);
        setCategories(data.categories);
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

  useEffect(() => {
    const live = new Set(liveRoster.map((c) => c.companion_id));
    const ids = new Set<string>();
    for (const { key, record } of liveHires(liveRoster, MARKET_KEY_PREFIX)) {
      if (live.has(record.companion_id)) {
        const idx = key.indexOf(':');
        ids.add(idx === -1 ? key : key.slice(idx + 1));
      }
    }
    setHiredIds(ids);
  }, [liveRoster]);

  const visible = useMemo(() => {
    return experts.filter((e) => {
      if (category && e.category !== category) return false;
      return matchesQuery(e, query);
    });
  }, [experts, category, query]);

  const myHires = useMemo(() => liveHires(liveRoster), [liveRoster]);

  const openCompanion = useCallback(
    (companionId: CompanionId) => {
      setDetail(null);
      void (async () => {
        if (onHired) await onHired(companionId);
        else navigate(`/geekclaw?companion=${encodeURIComponent(companionId)}`);
      })();
    },
    [navigate, onHired]
  );

  const hire = useCallback(
    async (expert: ProfessionalExpert) => {
      if (pendingId) return;
      setPendingId(expert.id);
      try {
        const companionId = await hireLocalExpert({
          key: `${MARKET_KEY_PREFIX}${expert.id}`,
          name: expert.name,
          subtitle: expert.category,
          source: 'market',
          persona: expert.persona,
          roster: liveRoster,
        });
        await refreshRoster();
        Message.success(
          t('expertMarket.hired', { defaultValue: '雇佣成功，数字分身已生成' })
        );
        openCompanion(companionId);
      } catch (err) {
        Message.error(String(err));
      } finally {
        setPendingId(null);
      }
    },
    [liveRoster, openCompanion, pendingId, refreshRoster, t]
  );

  return (
    <HubPageShell
      title={t('expertMarket.title', { defaultValue: '专家数字分身市场' })}
      subtitle={t('expertMarket.subtitle', {
        defaultValue: '把行业专家雇佣成你的数字员工，即开即用、随取随聊。',
      })}
      toolbar={
        <div className='flex items-center justify-between w-full'>
          <Tabs activeTab={tab} onChange={(key) => setTab(key as 'builtin' | 'mine')}>
            <Tabs.TabPane
              key='builtin'
              title={t('expertMarket.tabBuiltin', { defaultValue: '专家目录' })}
            />
            <Tabs.TabPane
              key='mine'
              title={`${t('expertMarket.tabMine', { defaultValue: '我的专家' })}${
                myHires.length ? ` (${myHires.length})` : ''
              }`}
            />
          </Tabs>
          <div className='flex items-center gap-10px'>
            <Button
              type='primary'
              size='small'
              icon={<Plus size={16} />}
              onClick={() => navigate('/geekclaw')}
            >
              {t('expertMarket.newCompanion', { defaultValue: '新建数字员工' })}
            </Button>
          </div>
        </div>
      }
    >
      {tab !== 'mine' ? (
        <>
          <div className='flex flex-wrap items-center gap-10px mb-18px'>
            <Input
              allowClear
              prefix={<Search size={16} />}
              placeholder={t('expertMarket.searchPlaceholder', { defaultValue: '搜索专家名称 / 分类 / 简介' })}
              value={query}
              onChange={setQuery}
              style={{ width: 280 }}
            />
            <Select
              allowClear
              placeholder={t('expertMarket.categoryPlaceholder', { defaultValue: '全部分类' })}
              value={category}
              onChange={(v) => setCategory(v)}
              style={{ width: 200 }}
              options={categories.map((c) => ({ label: `${c.name}（${c.count}）`, value: c.name }))}
            />
            <span className='text-12px text-t-tertiary'>
              共 {experts.length} 位专业专家 · 全部内置
            </span>
          </div>

          {loading ? (
            <div className='flex items-center justify-center py-60px'>
              <Spin />
            </div>
          ) : visible.length === 0 ? (
            <div className='flex flex-col items-center gap-12px py-40px'>
              <Empty description={t('expertMarket.empty', { defaultValue: '没有匹配到的专家' })} />
            </div>
          ) : (
            <div className='grid gap-14px grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
              {visible.map((e) => (
                <ExpertCard
                  key={e.id}
                  expert={e}
                  hired={hiredIds.has(e.id)}
                  pending={pendingId === e.id}
                  onOpen={setDetail}
                  onHire={(x) => void hire(x)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {myHires.length === 0 ? (
            <div className='flex flex-col items-center gap-12px py-40px'>
              <Empty description={t('expertMarket.mineEmpty', { defaultValue: '还没有雇佣任何专家' })} />
              <Button type='primary' icon={<Shop size={16} />} onClick={() => setTab('builtin')}>
                {t('expertMarket.title', { defaultValue: '专家数字分身市场' })}
              </Button>
            </div>
          ) : (
            <div className='grid gap-12px grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'>
              {myHires.map(({ key, record }) => (
                <div
                  key={key}
                  className='flex items-center gap-10px p-14px rd-12px border border-solid border-[var(--color-border-2)] bg-fill-1'
                >
                  <ExpertAvatar name={record.name} size={40} />
                  <div className='min-w-0 flex-1'>
                    <div className='text-14px font-600 text-t-primary truncate'>{record.name}</div>
                    <div className='text-12px leading-16px text-t-tertiary truncate'>
                      {record.subtitle}
                      {record.source === 'board' ? ' · 董事会' : ''}
                    </div>
                  </div>
                  <Button
                    type='primary'
                    size='mini'
                    onClick={() => openCompanion(record.companion_id)}
                  >
                    打开分身
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* 专家详情抽屉 */}
      <Drawer
        width={420}
        title={detail ? detail.name : t('expertMarket.detail', { defaultValue: '专家详情' })}
        visible={detail !== null}
        onCancel={() => setDetail(null)}
        footer={
          detail && (
            <div className='flex items-center justify-between'>
              <span className='px-8px py-2px rd-6px bg-[rgba(16,185,129,0.14)] text-12px text-[rgb(16,185,129)] font-600'>
                内置 · 免费
              </span>
              <Button
                type='primary'
                loading={pendingId === detail.id}
                onClick={() => void hire(detail)}
              >
                {hiredIds.has(detail.id) ? '打开分身' : '雇佣'}
              </Button>
            </div>
          )
        }
      >
        {detail ? (
          <div className='flex flex-col gap-16px'>
            <div className='flex items-center gap-12px'>
              <ExpertAvatar name={detail.name} size={56} />
              <div>
                <div className='text-17px font-700 text-t-primary'>{detail.name}</div>
                <div className='text-13px text-t-tertiary mt-2px'>{detail.title}</div>
              </div>
            </div>

            <Tag size='small' color='arcoblue'>
              {detail.category}
            </Tag>

            <div>
              <div className='text-13px font-600 text-t-secondary mb-4px'>
                {t('expertMarket.about', { defaultValue: '简介' })}
              </div>
              <p className='text-13px leading-20px text-t-tertiary m-0 whitespace-pre-wrap'>
                {detail.description || detail.tagline || '—'}
              </p>
            </div>

            <div className='rounded-lg bg-fill-2 p-12px'>
              <div className='text-13px font-600 text-t-secondary mb-6px'>
                {t('expertMarket.persona', { defaultValue: '专家人格设定' })}
              </div>
              <p className='text-12px leading-18px text-t-tertiary m-0 whitespace-pre-wrap max-h-240px overflow-y-auto'>
                {detail.persona}
              </p>
            </div>
          </div>
        ) : null}
      </Drawer>
    </HubPageShell>
  );
};

export default ExpertMarketPage;
