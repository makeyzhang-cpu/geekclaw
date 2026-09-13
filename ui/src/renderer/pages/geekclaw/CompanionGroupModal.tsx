/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Modal } from '@arco-design/web-react';
import { Check } from '@icon-park/react';
import classNames from 'classnames';
import type { ICompanionProfile, ICompanionWithStatus } from '@/common/adapter/ipcBridge';
import CompanionAvatar from '@renderer/pages/companion/CompanionAvatar';
import { customFigureMetaOf } from '@renderer/pages/companion/characters/customMeta';
import type { CompanionMood } from '@renderer/pages/companion/characters';

interface CompanionGroupModalProps {
  visible: boolean;
  /** Roster to pick from (page-level useCompanions result). */
  companions: ICompanionWithStatus[];
  loading?: boolean;
  confirming?: boolean;
  onCancel: () => void;
  onConfirm: (members: ICompanionProfile[], name: string) => void;
}

/**
 * 员工圆桌群聊选择弹窗 — 挑 ≥2 位数字员工组一个群聊会话。
 * 圆桌 MVP（方案 A）：群聊由合成人格的单一会话承载，见 useCompanionGroupLauncher。
 */
const CompanionGroupModal: React.FC<CompanionGroupModalProps> = ({
  visible,
  companions,
  loading = false,
  confirming = false,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [name, setName] = useState('');

  // 每次打开重置选择与群名，避免上一次的草稿残留。
  useEffect(() => {
    if (visible) {
      setSelectedIds([]);
      setName('');
    }
  }, [visible]);

  const toggle = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selected = useMemo(
    () => companions.filter((c) => selectedIds.includes(c.companion_id)),
    [companions, selectedIds]
  );

  const fallbackName = selected.length > 0 ? `${selected.map((m) => m.name).join('、')} 的群聊` : '';
  const canConfirm = selected.length >= 2 && !confirming;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(
      selected.map((c) => {
        const { status: _status, ...profile } = c;
        return profile as ICompanionProfile;
      }),
      name
    );
  };

  return (
    <Modal
      visible={visible}
      onCancel={onCancel}
      title={t('geekclaw.group.modalTitle', { defaultValue: '发起员工群聊' })}
      okText={t('geekclaw.group.start', { defaultValue: '开聊' })}
      cancelText={t('common.cancel', { defaultValue: '取消' })}
      okButtonProps={{ disabled: !canConfirm, loading: confirming }}
      onOk={handleConfirm}
      unmountOnExit
      style={{ width: 520 }}
    >
      <div className='flex flex-col gap-12px pt-4px'>
        <Input
          value={name}
          onChange={setName}
          allowClear
          maxLength={40}
          placeholder={
            fallbackName ||
            t('geekclaw.group.namePlaceholder', { defaultValue: '群聊名称（默认按成员自动生成）' })
          }
        />
        <div className='text-12px text-t-tertiary'>
          {t('geekclaw.group.pickHint', {
            defaultValue: '选择 2 位及以上员工加入群聊；群聊中 @名字 可点名发言。',
          })}
          <span className='ml-6px text-t-quaternary'>
            {t('geekclaw.group.pickedCount', { defaultValue: '已选 {{count}} 位', count: selected.length })}
          </span>
        </div>
        <div className='max-h-320px overflow-y-auto grid grid-cols-2 gap-8px pr-2px'>
          {loading && (
            <div className='col-span-2 py-24px text-center text-12px text-t-tertiary'>
              {t('common.loading', { defaultValue: '加载中…' })}
            </div>
          )}
          {!loading && companions.length === 0 && (
            <div className='col-span-2 py-24px text-center text-12px text-t-tertiary'>
              {t('geekclaw.group.noCompanion', { defaultValue: '还没有数字员工，先新建员工再来组群聊吧' })}
            </div>
          )}
          {companions.map((c) => {
            const active = selectedIds.includes(c.companion_id);
            return (
              <div
                key={c.companion_id}
                role='checkbox'
                aria-checked={active}
                tabIndex={0}
                onClick={() => toggle(c.companion_id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggle(c.companion_id);
                  }
                }}
                className={classNames(
                  'flex items-center gap-8px h-52px rd-10px px-10px cursor-pointer box-border outline-none transition-colors border',
                  active
                    ? 'border-primary-6 bg-[rgba(var(--primary-6),0.08)] text-primary-6'
                    : 'border-[var(--color-border-2)] bg-[var(--color-bg-2)] hover:bg-fill-2 text-t-primary'
                )}
              >
                <CompanionAvatar
                  character={c.character}
                  companionId={c.companion_id}
                  customFigure={customFigureMetaOf(c)}
                  mood={(c.status?.mood as CompanionMood) || 'content'}
                  activity='idle'
                  size={30}
                />
                <span className='flex flex-col min-w-0 flex-1'>
                  <span className='text-13px font-500 leading-18px truncate'>{c.name}</span>
                  {c.status && (
                    <span className='text-11px leading-16px text-t-tertiary'>
                      Lv{c.status.level}
                    </span>
                  )}
                </span>
                <span
                  className={classNames(
                    'flex items-center justify-center size-18px rd-full shrink-0 border transition-colors',
                    active ? 'bg-primary-6 border-primary-6 text-[var(--color-bg-1)]' : 'border-[var(--color-border-3)]'
                  )}
                >
                  {active && <Check theme='outline' size='12' fill='currentColor' strokeWidth={4} />}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
};

export default CompanionGroupModal;
