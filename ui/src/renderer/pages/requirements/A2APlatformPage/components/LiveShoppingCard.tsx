/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { A2A_LIVE_RED, A2A_THEME } from '../theme';

interface Props {
  /** 当前模型名 */
  modelName: string;
  /** 当前语言显示名 */
  localeLabel: string;
}

/**
 * 右侧 LIVE 购物卡片（参考 ukenmall "从需求到订单"）。
 * - LIVE 红点呼吸
 * - 显示当前模型 + 语言
 * - "AI 购物" 状态信息
 */
const LiveShoppingCard: React.FC<Props> = ({ modelName, localeLabel }) => {
  const { t } = useTranslation();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const seconds = tick % 60;
  const minutes = Math.floor(tick / 60) % 60;
  const hours = Math.floor(tick / 3600);

  return (
    <div className='sticky top-20px flex flex-col gap-12px rounded-20px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-1)] p-16px shadow-[0_4px_14px_rgba(0,0,0,0.04)]'>
      {/* LIVE 标记 */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-6px'>
          <span
            className='inline-block w-8px h-8px rounded-50%'
            style={{ background: A2A_LIVE_RED, animation: 'a2a-pulse 1.6s ease-in-out infinite' }}
          />
          <span className='text-12px font-700 text-t-primary'>{t('requirements.a2a.platform.live.label')}</span>
        </div>
        <span className='text-11px text-t-tertiary'>
          {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </span>
      </div>

      {/* 主标题 */}
      <div className='text-15px font-700 text-t-primary leading-tight'>
        {t('requirements.a2a.platform.live.title')}
      </div>
      <div className='text-12px text-t-tertiary leading-20px'>
        {t('requirements.a2a.platform.live.subtitle')}
      </div>

      {/* 当前模型 + 语言 */}
      <div className='flex flex-col gap-6px rounded-12px bg-[var(--color-fill-1)] p-12px'>
        <div className='flex items-center justify-between text-11px'>
          <span className='text-t-tertiary'>{t('requirements.a2a.platform.live.model')}</span>
          <span className='font-600 text-t-primary'>{modelName}</span>
        </div>
        <div className='flex items-center justify-between text-11px'>
          <span className='text-t-tertiary'>{t('requirements.a2a.platform.live.locale')}</span>
          <span className='font-600 text-t-primary'>{localeLabel}</span>
        </div>
      </div>

      {/* 推荐套餐 */}
      <div className='flex flex-col gap-6px'>
        <div className='text-11px text-t-tertiary'>{t('requirements.a2a.platform.live.pkgTitle')}</div>
        <div
          className='rounded-12px p-12px text-12px'
          style={{ background: A2A_THEME.primarySoft }}
        >
          <div className='font-600 text-t-primary'>{t('requirements.a2a.platform.live.pkg1Name')}</div>
          <div className='text-t-secondary mt-2px leading-18px'>{t('requirements.a2a.platform.live.pkg1Desc')}</div>
          <div className='text-primary-6 font-700 mt-6px' style={{ color: A2A_THEME.primaryStrong }}>{t('requirements.a2a.platform.live.pkg1Price')}</div>
        </div>
      </div>

      <style>{`
        @keyframes a2a-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.15); }
        }
      `}</style>
    </div>
  );
};

export default LiveShoppingCard;