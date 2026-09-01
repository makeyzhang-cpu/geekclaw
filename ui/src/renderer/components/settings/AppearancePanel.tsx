/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckOne, EditTwo, Plus } from '@icon-park/react';
import classNames from 'classnames';
import { ThemeSwitcher } from '@renderer/components/settings/ThemeSwitcher';
import FontSizeControl from '@renderer/components/settings/FontSizeControl';
import { getCssThemeDisplayName } from '@renderer/pages/settings/DisplaySettings/presets';
import { useCssTheme } from '@renderer/hooks/ui/useCssTheme';
import type { ICssTheme } from '@/common/config/storage';

/** Pull a representative accent color out of a preset's CSS for the swatch dot. */
const pickAccent = (css: string): string | null => {
  const match = css.match(/--(?:color-primary|primary-6)\s*:\s*([^;!}]+)/i);
  if (!match) return null;
  const value = match[1].trim().replace(/\s*!important\s*/i, '');
  if (!value || /var\(/i.test(value)) return null;
  if (/^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(value)) return `rgb(${value})`;
  return value;
};

interface AppearancePanelProps {
  /** Open the CSS-theme editor for `theme` (or null to add a new one). The
   *  owning surface (a Sider popover or the UserMenu popup) renders the actual
   *  `CssThemeModal` OUTSIDE the panel so it survives the surface unmounting. */
  onEditTheme: (theme: ICssTheme | null) => void;
}

/**
 * AppearancePanel — the full appearance surface, shared by the Sider footer
 * theme control and the UserMenu settings submenu so the feature is never
 * "lost" when one entry point is removed:
 *   • 明暗模式 light / dark  (ThemeSwitcher)
 *   • 界面缩放 interface scaling (FontSizeControl)
 *   • CSS 预设主题 preset/skin list with per-row edit + "add manually"
 */
const AppearancePanel: React.FC<AppearancePanelProps> = ({ onEditTheme }) => {
  const { t } = useTranslation();
  const { themes, activeThemeId, selectTheme } = useCssTheme();

  return (
    <div className='w-full flex flex-col gap-10px py-2px'>
      {/* 明暗 / Light–dark */}
      <div className='flex flex-col gap-6px'>
        <div className='text-12px font-500 text-t-tertiary px-2px'>{t('settings.theme')}</div>
        <ThemeSwitcher />
      </div>

      {/* 界面缩放 / Interface scaling */}
      <div className='flex flex-col gap-6px'>
        <div className='text-12px font-500 text-t-tertiary px-2px'>{t('settings.fontSize')}</div>
        <FontSizeControl />
      </div>

      {/* CSS 预设主题 / CSS preset themes */}
      <div className='flex flex-col gap-6px'>
        <div className='text-12px font-500 text-t-tertiary px-2px'>{t('settings.cssTheme.selectOrCustomize')}</div>
        <div className='flex flex-col gap-2px max-h-300px overflow-y-auto -mx-4px px-4px'>
          {themes.map((theme) => {
            const active = activeThemeId === theme.id;
            const accent = pickAccent(theme.css || '');
            const displayName = getCssThemeDisplayName(theme, t);
            return (
              <div
                key={theme.id}
                className={classNames(
                  'group flex items-center gap-8px h-32px px-8px rd-8px text-left transition-colors',
                  active ? '!bg-primary-1' : 'hover:bg-fill-2'
                )}
              >
                <button
                  type='button'
                  onClick={() => void selectTheme(theme)}
                  className='flex-1 min-w-0 flex items-center gap-8px cursor-pointer border-none bg-transparent p-0 text-left'
                >
                  <span
                    className='size-14px rd-full shrink-0 border border-solid border-[var(--color-border-2)]'
                    style={accent ? { background: accent } : { background: 'var(--color-fill-3)' }}
                  />
                  <span
                    className={classNames(
                      'flex-1 min-w-0 truncate text-13px',
                      active ? 'text-primary-6 font-500' : 'text-t-primary'
                    )}
                  >
                    {displayName}
                  </span>
                </button>
                {active && <CheckOne theme='filled' size='15' fill='rgb(var(--primary-6))' className='shrink-0' />}
                <button
                  type='button'
                  onClick={() => onEditTheme(theme)}
                  aria-label={t('settings.cssTheme.editTheme')}
                  className='shrink-0 opacity-0 group-hover:opacity-100 size-22px flex items-center justify-center rd-6px text-t-tertiary hover:text-primary-6 hover:bg-fill-3 cursor-pointer border-none bg-transparent transition-opacity'
                >
                  <EditTwo theme='outline' size='13' fill='currentColor' />
                </button>
              </div>
            );
          })}

          {/* 手动添加 CSS 样式 / Manually add a CSS theme */}
          <button
            type='button'
            onClick={() => onEditTheme(null)}
            className='flex items-center gap-8px h-32px px-8px rd-8px text-13px text-t-secondary hover:text-primary-6 hover:bg-fill-2 cursor-pointer border-none bg-transparent transition-colors'
          >
            <span className='size-14px shrink-0 flex items-center justify-center'>
              <Plus theme='outline' size='14' fill='currentColor' />
            </span>
            <span className='flex-1 min-w-0 truncate text-left'>{t('settings.cssTheme.addManually')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AppearancePanel;
