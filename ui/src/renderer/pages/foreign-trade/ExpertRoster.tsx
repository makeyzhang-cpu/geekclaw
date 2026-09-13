/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Tooltip } from '@arco-design/web-react';
import { Delete, Edit, Globe, LinkOut, Plus, Search, Shop } from '@icon-park/react';
import classNames from 'classnames';
import ContentSider from '@renderer/components/layout/ContentSider';
import { resolveExpertIcon } from '@renderer/pages/expert-agents/expertIcons';
import { groupByIdentityCategory, type ExpertIdentity } from '@renderer/pages/expert-agents/data';

interface ExpertRosterProps {
  /** Full expert identity roster (defaults + user-authored, from useExpertIdentities). */
  identities: ExpertIdentity[];
  selectedId: string | null;
  onSelect: (identity: ExpertIdentity) => void;
  /** Open the GeekLink external platform (in-app webview) — a standalone entry,
   *  deliberately NOT grouped with the skill library. */
  onOpenPlatform: () => void;
  /** Open the in-place skill library view. */
  onOpenSkills: () => void;
  /** Author a brand-new expert identity. */
  onCreate: () => void;
  onEdit: (identity: ExpertIdentity) => void;
  onDelete: (identity: ExpertIdentity) => void;
}

/**
 * 外贸专家名册 — B2B 外贸工作台的左栏。
 *
 * Same shell and item grammar as the 数字员工 roster (ContentSider + 44px rows),
 * but grouped by `ExpertIdentity.category` (外贸拓客 / 供应链履约 / …) because
 * experts are a curated catalogue rather than a user-owned list.
 * Authoring is inlined here (create / edit / delete) so the desk is self-contained.
 */
const ExpertRoster: React.FC<ExpertRosterProps> = ({
  identities,
  selectedId,
  onSelect,
  onOpenPlatform,
  onOpenSkills,
  onCreate,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState('');

  const groups = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const matched = q
      ? identities.filter(
          (item) =>
            item.name.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q) ||
            item.category.toLowerCase().includes(q)
        )
      : identities;
    return groupByIdentityCategory(matched);
  }, [identities, keyword]);

  const empty = groups.every((group) => group.items.length === 0);

  return (
    <ContentSider
      width={248}
      ariaLabel={t('foreignTrade.rosterLabel', { defaultValue: '外贸专家名册' })}
      header={
        <div className='px-8px pt-12px pb-8px flex flex-col gap-8px'>
          <Input
            value={keyword}
            onChange={setKeyword}
            allowClear
            prefix={<Search theme='outline' size='14' fill='currentColor' />}
            placeholder={t('foreignTrade.searchExpert', { defaultValue: '搜索外贸专家' })}
          />
        </div>
      }
      footer={
        <div className='px-8px pb-8px flex flex-col gap-6px'>
          <div
            role='button'
            tabIndex={0}
            onClick={onCreate}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onCreate();
              }
            }}
            className='flex items-center justify-center gap-6px h-32px rd-full px-12px cursor-pointer font-700 text-13px text-[var(--color-text-1)] bg-[rgba(var(--primary-6),0.12)] hover:bg-[rgba(var(--primary-6),0.18)] transition-colors box-border outline-none'
          >
            <Plus theme='outline' size='14' fill='currentColor' strokeWidth={3} />
            <span className='truncate'>
              {t('foreignTrade.createExpert', { defaultValue: '新建专家身份' })}
            </span>
          </div>
          <div
            role='button'
            tabIndex={0}
            onClick={onOpenSkills}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpenSkills();
              }
            }}
            className='flex items-center gap-6px h-32px rd-full px-12px cursor-pointer text-12px text-t-secondary bg-fill-2 hover:bg-fill-3 hover:text-t-primary transition-colors box-border outline-none'
          >
            <Shop theme='outline' size='14' fill='currentColor' strokeWidth={3} />
            <span className='truncate'>
              {t('foreignTrade.skillLibrary', { defaultValue: '专家技能库' })}
            </span>
          </div>
          {/* 独立入口：GeekLink 外贸平台 — 与「专家技能库」分区隔离，不并入技能库 */}
          <div className='mt-6px pt-8px border-t border-[var(--color-border-2)] flex flex-col gap-4px'>
            <span className='px-4px text-11px leading-16px text-t-tertiary truncate'>
              {t('foreignTrade.platformGroup', { defaultValue: '外部平台' })}
            </span>
            <div
              role='button'
              tabIndex={0}
              onClick={onOpenPlatform}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpenPlatform();
                }
              }}
              className='flex items-center gap-6px h-34px rd-10px px-10px cursor-pointer text-12px font-500 text-t-primary bg-[var(--color-bg-2)] border border-[var(--color-border-2)] hover:border-primary-6 hover:text-primary-6 transition-colors box-border outline-none'
            >
              <Globe theme='outline' size='15' fill='currentColor' strokeWidth={3} />
              <span className='flex-1 truncate'>
                {t('foreignTrade.cardTitle', { defaultValue: 'GeekLink 外贸平台' })}
              </span>
              <LinkOut theme='outline' size='13' fill='currentColor' />
            </div>
          </div>
        </div>
      }
    >
      <div className='flex flex-col gap-2px px-8px pb-8px'>
        {empty && (
          <div className='py-24px text-center text-12px text-t-tertiary'>
            {t('foreignTrade.noExpert', { defaultValue: '没有匹配的专家' })}
          </div>
        )}
        {groups.map((group) => (
          <div key={group.category} className='flex flex-col gap-2px'>
            <div className='px-8px pt-8px pb-4px text-11px font-500 text-t-tertiary truncate'>
              {group.category}
            </div>
            {group.items.map((item) => {
              const Icon = resolveExpertIcon(item.icon);
              const active = item.id === selectedId;
              return (
                <Tooltip key={item.id} content={item.description} position='right' mini>
                  <div
                    role='tab'
                    aria-selected={active}
                    tabIndex={0}
                    onClick={() => onSelect(item)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelect(item);
                      }
                    }}
                    className={classNames(
                      'group relative flex items-center gap-8px shrink-0 h-44px rd-8px pl-8px pr-6px cursor-pointer transition-colors box-border outline-none',
                      active
                        ? 'bg-primary-1 text-primary-6'
                        : 'text-t-primary hover:bg-fill-2 active:bg-fill-3'
                    )}
                  >
                    <span className='size-22px flex items-center justify-center shrink-0'>
                      <Icon theme='outline' size='16' fill='currentColor' />
                    </span>
                    <span className='flex flex-col min-w-0 flex-1'>
                      <span className='text-13px font-500 leading-18px truncate'>{item.name}</span>
                      <span className='text-11px leading-16px text-t-tertiary truncate'>
                        {item.description}
                      </span>
                    </span>
                    {/* Inline authoring: hover to edit/delete an expert identity.
                        Stop propagation so the row click (select) does not fire. */}
                    <span className='absolute right-6px top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-2px'>
                      <span
                        role='button'
                        tabIndex={-1}
                        aria-label={t('foreignTrade.editExpert', { defaultValue: '编辑专家' })}
                        onClick={(event) => {
                          event.stopPropagation();
                          onEdit(item);
                        }}
                        className='flex items-center justify-center size-22px rd-6px text-t-tertiary hover:text-primary-6 hover:bg-fill-3 cursor-pointer transition-colors outline-none'
                      >
                        <Edit theme='outline' size='13' fill='currentColor' />
                      </span>
                      <span
                        role='button'
                        tabIndex={-1}
                        aria-label={t('foreignTrade.deleteExpert', { defaultValue: '删除专家' })}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelete(item);
                        }}
                        className='flex items-center justify-center size-22px rd-6px text-t-tertiary hover:text-danger-6 hover:bg-danger-1 cursor-pointer transition-colors outline-none'
                      >
                        <Delete theme='outline' size='13' fill='currentColor' />
                      </span>
                    </span>
                  </div>
                </Tooltip>
              );
            })}
          </div>
        ))}
      </div>
    </ContentSider>
  );
};

export default ExpertRoster;
