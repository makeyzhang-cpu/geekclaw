/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { LocaleCode, LOCALES, loadLocale, saveLocale } from '../localization';

interface Props {
  onChange?: (code: LocaleCode) => void;
}

/** 11 语言切换器（参考 ukenmall 右侧语言菜单）。 */
const LanguageSwitcher: React.FC<Props> = ({ onChange }) => {
  const [current, setCurrent] = useState<LocaleCode>(() => loadLocale());
  const [open, setOpen] = useState(false);

  const handleSelect = (code: LocaleCode) => {
    setCurrent(code);
    saveLocale(code);
    setOpen(false);
    onChange?.(code);
  };

  const currentInfo = LOCALES.find((l) => l.code === current) ?? LOCALES[0];

  return (
    <div className='relative inline-block'>
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        className='flex items-center gap-6px rounded-20px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-1)] px-12px py-6px text-13px text-t-primary cursor-pointer transition-colors hover:border-[var(--color-primary-5)]'
      >
        <span className='text-15px leading-none'>{currentInfo.flag}</span>
        <span>{currentInfo.nativeLabel}</span>
        <span className='text-t-tertiary text-11px'>▾</span>
      </button>
      {open && (
        <>
          <div className='fixed inset-0 z-9' onClick={() => setOpen(false)} aria-hidden />
          <div className='absolute right-0 top-[110%] z-10 min-w-[200px] max-h-[400px] overflow-y-auto rounded-16px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-1)] shadow-[0_8px_28px_rgba(0,0,0,0.10)] p-6px'>
            {LOCALES.map((l) => {
              const isCurrent = l.code === current;
              return (
                <button
                  key={l.code}
                  type='button'
                  onClick={() => handleSelect(l.code)}
                  className={
                    'flex items-center gap-10px w-full text-left px-10px py-8px rounded-10px cursor-pointer transition-colors ' +
                    (isCurrent
                      ? 'bg-[var(--color-primary-1)]'
                      : 'hover:bg-[var(--color-fill-2)]')
                  }
                  dir={l.rtl ? 'rtl' : 'ltr'}
                >
                  <span className='text-18px leading-none'>{l.flag}</span>
                  <span className='flex-1 text-13px text-t-primary'>{l.nativeLabel}</span>
                  {isCurrent && <span className='text-12px text-[var(--color-primary-6)]'>✓</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default LanguageSwitcher;