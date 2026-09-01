/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AIModel, AI_MODELS, loadSelectedModel, saveSelectedModel } from '../models';

interface Props {
  onModelChange?: (m: AIModel) => void;
}

/** 顶部 AI 模型选择器（参考 ukenmall Qwen 3.6 下拉）。 */
const ModelSelector: React.FC<Props> = ({ onModelChange }) => {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<AIModel>(() => loadSelectedModel());
  const [open, setOpen] = useState(false);

  const handleSelect = (m: AIModel) => {
    setCurrent(m);
    saveSelectedModel(m.id);
    setOpen(false);
    onModelChange?.(m);
  };

  return (
    <div className='relative inline-block'>
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        className='flex items-center gap-6px rounded-20px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-1)] px-12px py-6px text-13px text-t-primary cursor-pointer transition-colors hover:border-[var(--color-primary-5)]'
      >
        <span>{current.name}</span>
        <span className='text-t-tertiary text-11px'>▾</span>
      </button>
      {open && (
        <>
          <div
            className='fixed inset-0 z-9'
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className='absolute right-0 top-[110%] z-10 min-w-[280px] rounded-16px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-1)] shadow-[0_8px_28px_rgba(0,0,0,0.10)] p-6px'>
            {AI_MODELS.map((m) => {
              const isCurrent = m.id === current.id;
              return (
                <button
                  key={m.id}
                  type='button'
                  onClick={() => handleSelect(m)}
                  className={
                    'flex items-start gap-10px w-full text-left px-10px py-10px rounded-12px cursor-pointer transition-colors ' +
                    (isCurrent
                      ? 'bg-[var(--color-primary-1)]'
                      : 'hover:bg-[var(--color-fill-2)]')
                  }
                >
                  <span className='text-20px leading-none mt-2px'>{m.flag}</span>
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-baseline gap-6px'>
                      <span className='text-13px font-600 text-t-primary'>{m.name}</span>
                      {isCurrent && (
                        <span className='text-12px text-[var(--color-primary-6)]'>✓</span>
                      )}
                    </div>
                    <div className='text-11px text-t-tertiary mt-2px'>{m.description}</div>
                    <div className='text-11px text-t-tertiary mt-2px'>
                      {m.vendor} · {m.capability === 'image-gen' ? t('requirements.a2a.platform.model.imageGen') : t('requirements.a2a.platform.model.chat')}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default ModelSelector;