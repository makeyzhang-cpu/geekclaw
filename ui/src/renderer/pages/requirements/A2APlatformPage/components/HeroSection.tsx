/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@arco-design/web-react';
import { Plus, Send, Right } from '@icon-park/react';
import { A2A_HERO_GRADIENT } from '../theme';

interface Props {
  /** 推荐 chip 列表（行业热点、季节、目的地等） */
  chips: string[];
  /** 当前选中语言 RTL */
  rtl?: boolean;
  /** 用户输入回调 */
  onSend: (text: string) => void;
  /** 是否正在响应（禁用输入） */
  busy?: boolean;
}

/**
 * Hero 大标题 + 中央输入框 + 推荐 chip 引导。
 *
 * 参考 ukenmall.com 首页："所想即所得，万物皆可交易"
 * A2A 跨境电商版本：突出"AI 多模型 + 11 语言 + 全球本土化"卖点。
 */
const HeroSection: React.FC<Props> = ({ chips, rtl, onSend, busy }) => {
  const { t } = useTranslation();
  const [input, setInput] = useState('');

  const handleSend = () => {
    const text = input.trim();
    if (!text || busy) return;
    onSend(text);
    setInput('');
  };

  const handleChip = (chip: string) => {
    if (busy) return;
    onSend(chip);
  };

  return (
    <div
      className='flex flex-col items-center gap-20px px-24px py-40px rounded-24px'
      style={{ background: A2A_HERO_GRADIENT }}
      dir={rtl ? 'rtl' : 'ltr'}
    >
      {/* 小标签 */}
      <div className='inline-flex items-center gap-6px rounded-20px bg-[var(--color-primary-1)] px-12px py-4px text-12px font-600 text-[var(--color-primary-6)]'>
        🌐 A2A 智能体商谈™
      </div>

      {/* 大标题 */}
      <h1 className='text-center text-36px sm:text-44px font-700 leading-tight text-t-primary tracking-tight'>
        {t('requirements.a2a.platform.hero.slogan')}
      </h1>

      {/* 副标题 */}
      <p className='text-center text-14px sm:text-15px leading-24px text-t-secondary max-w-[640px]'>
        {t('requirements.a2a.platform.hero.subtitle')}
      </p>

      {/* 中央大输入框 */}
      <div className='w-full max-w-[680px] flex items-center gap-8px rounded-999px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-1)] px-16px py-6px shadow-[0_4px_14px_rgba(255,106,0,0.06)] focus-within:border-[var(--color-primary-5)] transition-colors'>
        <Plus theme='outline' size='18' className='text-t-tertiary flex-none' />
        <Input
          value={input}
          onChange={setInput}
          onPressEnter={handleSend}
          placeholder={t('requirements.a2a.platform.hero.placeholder')}
          className='flex-1 !bg-transparent !border-none !shadow-none'
          disabled={busy}
          size='large'
        />
        <Button
          type='primary'
          shape='circle'
          icon={<Right theme='outline' size='16' />}
          onClick={handleSend}
          disabled={!input.trim() || busy}
        />
      </div>

      {/* 推荐 chip 行 */}
      <div className='w-full max-w-[780px] flex flex-wrap gap-8px justify-center'>
        {chips.map((chip) => (
          <button
            key={chip}
            type='button'
            onClick={() => handleChip(chip)}
            disabled={busy}
            className='cursor-pointer rounded-20px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-1)] px-14px py-7px text-13px text-t-secondary transition-all hover:border-[var(--color-primary-5)] hover:text-[var(--color-primary-6)] hover:shadow-[0_2px_8px_rgba(255,106,0,0.10)] disabled:opacity-50'
          >
            {chip}
          </button>
        ))}
      </div>

      {/* 底部小提示 */}
      <div className='flex items-center gap-6px text-12px text-t-tertiary'>
        <span>{t('requirements.a2a.platform.hero.poweredBy')}</span>
      </div>
    </div>
  );
};

export default HeroSection;