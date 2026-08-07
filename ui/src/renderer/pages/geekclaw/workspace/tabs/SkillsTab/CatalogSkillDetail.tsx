/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Close } from '@icon-park/react';
import SkillButton from './SkillButton';
import { MetaRow } from './GeneratedSkillDetail';
import type { CatalogSkillEntry } from './unify';

interface CatalogSkillDetailProps {
  entry: CatalogSkillEntry;
  /** This grant's patch is in flight. */
  busy: boolean;
  /** Revoking is not possible right now (another patch in flight / no profile). */
  disabled: boolean;
  onRevoke: () => void;
}

/** Catalog `source` → a human label; unknown sources fall back to the raw value. */
const useSourceLabel = (source: string): string => {
  const { t } = useTranslation();
  if (source === 'builtin') return t('geekclaw.skills.catalogSourceBuiltin', { defaultValue: '内置' });
  if (source === 'custom') return t('geekclaw.skills.catalogSourceCustom', { defaultValue: '自定义' });
  if (source === 'extension') return t('geekclaw.skills.catalogSourceExtension', { defaultValue: '扩展' });
  return source;
};

/**
 * A granted catalog capability has no per-companion file to edit — the Skill
 * itself lives in the global library. So this pane explains what was granted and
 * offers the one per-companion action there is: take the grant away.
 */
const CatalogSkillDetail: React.FC<CatalogSkillDetailProps> = ({ entry, busy, disabled, onRevoke }) => {
  const { t } = useTranslation();
  const sourceLabel = useSourceLabel(entry.source);

  return (
    <div className='flex flex-col gap-16px'>
      <div className='text-13px leading-20px text-t-secondary break-words'>
        {entry.description?.trim() || t('geekclaw.skills.noDescription', { defaultValue: '这个技能还没有描述' })}
      </div>

      <MetaRow label={t('geekclaw.skills.metaGrant', { defaultValue: '授予方式' })}>
        {entry.isAuto
          ? t('geekclaw.skills.configDefault', { defaultValue: '默认能力' })
          : t('geekclaw.skills.configOptional', { defaultValue: '额外能力' })}
      </MetaRow>
      <MetaRow label={t('geekclaw.skills.metaCatalogSource', { defaultValue: '来自' })}>{sourceLabel}</MetaRow>
      <MetaRow label={t('geekclaw.skills.metaLocation', { defaultValue: '安装位置' })}>
        {entry.installed ? (
          <span className='font-mono text-11px leading-16px text-t-secondary break-all'>{entry.location}</span>
        ) : (
          t('geekclaw.skills.configMissingHint', {
            defaultValue: '这个 Skill 当前未安装；重新安装后会自动恢复。',
          })
        )}
      </MetaRow>

      <div className='flex flex-col gap-8px border-t border-t-solid border-t-[var(--color-border-2)] pt-12px'>
        <span className='text-12px leading-18px text-t-tertiary'>
          {t('geekclaw.skills.revokeHint', {
            defaultValue: '取消授予只影响这个伙伴，技能库里的 Skill 不会被删除。',
          })}
        </span>
        <SkillButton
          tone='danger'
          disabled={busy || disabled}
          className='self-start'
          icon={<Close theme='outline' size='12' fill='currentColor' strokeWidth={4} />}
          onClick={onRevoke}
        >
          {t('geekclaw.skills.revoke', { defaultValue: '取消授予' })}
        </SkillButton>
      </div>
    </div>
  );
};

export default CatalogSkillDetail;
