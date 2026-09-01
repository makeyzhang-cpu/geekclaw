/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { A2A_THEME } from '../theme';

interface Props {
  /** 会话列表 */
  sessions: { id: string; title: string; preview: string }[];
  /** 当前激活的会话 */
  activeId: string | null;
  /** 新建会话 */
  onNew: () => void;
  /** 选择会话 */
  onSelect: (id: string) => void;
  rtl?: boolean;
}

/**
 * 左侧栏（参考 ukenmall 新对话 / 智能体 / 搜索对话）。
 * - Logo + 品牌名
 * - 主操作（新建对话）
 * - 会话历史列表
 */
const Sidebar: React.FC<Props> = ({ sessions, activeId, onNew, onSelect, rtl }) => {
  const { t } = useTranslation();
  return (
    <div className='flex flex-col gap-12px h-full' dir={rtl ? 'rtl' : 'ltr'}>
      {/* Logo */}
      <div className='flex items-center gap-8px px-8px py-6px'>
        <div
          className='w-32px h-32px rounded-10px flex items-center justify-center text-16px font-800'
          style={{ background: A2A_THEME.primary, color: A2A_THEME.onPrimary }}
        >
          G
        </div>
        <span className='text-15px font-700 text-t-primary'>GeekClaw</span>
      </div>

      {/* 主操作 */}
      <button
        type='button'
        onClick={onNew}
        className='flex items-center gap-8px w-full rounded-12px px-12px py-10px text-13px text-t-secondary cursor-pointer transition-colors border-none bg-transparent text-left hover:bg-[var(--color-fill-2)]'
      >
        <span className='text-16px'>+</span>
        <span>{t('requirements.a2a.platform.sidebar.newChat')}</span>
      </button>

      <button
        type='button'
        className='flex items-center gap-8px w-full rounded-12px px-12px py-10px text-13px text-t-secondary cursor-pointer transition-colors border-none bg-transparent text-left hover:bg-[var(--color-fill-2)]'
      >
        <span>🤖</span>
        <span>{t('requirements.a2a.platform.sidebar.agents')}</span>
      </button>

      <button
        type='button'
        className='flex items-center gap-8px w-full rounded-12px px-12px py-10px text-13px text-t-secondary cursor-pointer transition-colors border-none bg-transparent text-left hover:bg-[var(--color-fill-2)]'
      >
        <span>🔍</span>
        <span>{t('requirements.a2a.platform.sidebar.search')}</span>
      </button>

      {/* 购物车 */}
      <button
        type='button'
        className='flex items-center gap-8px w-full rounded-12px px-12px py-10px text-13px text-t-secondary cursor-pointer transition-colors border-none bg-transparent text-left hover:bg-[var(--color-fill-2)] mt-auto'
      >
        <span>🛒</span>
        <span>{t('requirements.a2a.platform.sidebar.cart')}</span>
      </button>

      {/* 会话历史 */}
      {sessions.length > 0 && (
        <div className='flex flex-col gap-4px mt-6px overflow-y-auto flex-1'>
          <div className='text-11px text-t-tertiary px-8px py-2px'>
            {t('requirements.a2a.platform.sidebar.history')}
          </div>
          {sessions.slice(0, 8).map((s) => (
            <button
              key={s.id}
              type='button'
              onClick={() => onSelect(s.id)}
              className={
                'flex flex-col gap-2px w-full rounded-10px px-10px py-8px cursor-pointer transition-colors border-none text-left ' +
                (activeId === s.id
                  ? 'bg-[var(--color-primary-1)]'
                  : 'bg-transparent hover:bg-[var(--color-fill-2)]')
              }
            >
              <div className='text-12px font-600 text-t-primary line-clamp-1'>{s.title}</div>
              <div className='text-10px text-t-tertiary line-clamp-1'>{s.preview}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default Sidebar;