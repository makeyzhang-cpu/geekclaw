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
  /** 标题 / 主按钮 / 规则说明的可定制文案（默认按「发起员工群聊」场景）。 */
  title?: string;
  okText?: string;
  hint?: string;
  onCancel: () => void;
  onConfirm: (members: ICompanionProfile[], name: string) => void;
}

/**
 * 员工多选弹窗 —— 挑 ≥2 位数字员工组一个「团队」。
 * 两个使用场景共用：
 *  1. 数字员工页「召唤伙伴」→ 圆桌群聊（方案 A：合成人格的单一会话承载）；
 *  2. 会话页「协作者」面板「召唤员工」→ 把多位员工合成协作团队人格。
 * 圆桌 MVP（方案 A）：见 useCompanionGroupLauncher。
 */
const CompanionGroupModal: React.FC<CompanionGroupModalProps> = ({
  visible,
  companions,
  loading = false,
  confirming = false,
  title,
  okText,
  hint,
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
      title={title ?? t('geekclaw.group.modalTitle', { defaultValue: '发起员工群聊' })}
      okText={okText ?? t('geekclaw.group.start', { defaultValue: '开聊' })}
      cancelText={t('common.cancel', { defaultValue: '取消' })}
      okButtonProps={{ disabled: !canConfirm, loading: confirming }}
      onOk={handleConfirm}
      unmountOnExit
      style={{ width: 580 }}
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
          {hint ?? t('geekclaw.group.pickHint', {
            defaultValue: '选择 2 位及以上员工加入群聊；群聊中 @名字 可点名发言。',
          })}
          <span className='ml-6px text-t-quaternary'>
            {t('geekclaw.group.pickedCount', { defaultValue: '已选 {{count}} 位', count: selected.length })}
          </span>
        </div>
        {/* 成员卡：左姓名 / 职位，右立绘（与工作台「一起工作」会话栏同一套卡片语法） */}
        <div className='max-h-360px overflow-y-auto grid grid-cols-2 gap-10px pr-2px'>
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
                  'relative flex items-center gap-8px h-84px rd-14px px-13px box-border overflow-hidden cursor-pointer outline-none transition-all border',
                  active
                    ? 'border-primary-6 bg-[rgba(var(--primary-6),0.06)] shadow-[0_6px_18px_rgba(0,0,0,0.08)]'
                    : 'border-[var(--color-border-2)] bg-[var(--color-bg-2)] hover:border-primary-5 hover:shadow-[0_6px_18px_rgba(0,0,0,0.06)]'
                )}
              >
                <span className='flex flex-col min-w-0 flex-1'>
                  <span className='text-14px leading-20px font-600 text-t-primary truncate'>
                    {c.name}
                  </span>
                  <span className='text-11px leading-16px text-t-tertiary truncate'>
                    {c.status
                      ? `Lv${c.status.level}`
                      : t('geekclaw.companions.createTitle', { defaultValue: '数字员工' })}
                  </span>
                </span>
                <span className='shrink-0 size-60px flex items-end justify-center overflow-hidden rd-14px bg-fill-1'>
                  <CompanionAvatar
                    character={c.character}
                    companionId={c.companion_id}
                    customFigure={customFigureMetaOf(c)}
                    mood={(c.status?.mood as CompanionMood) || 'content'}
                    activity='idle'
                    size={60}
                  />
                </span>
                {active && (
                  <span className='absolute top-7px right-7px flex items-center justify-center size-18px rd-full bg-primary-6 text-[var(--color-bg-1)] ring-2 ring-[var(--color-bg-2)]'>
                    <Check theme='outline' size='12' fill='currentColor' strokeWidth={4} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
};

export default CompanionGroupModal;
