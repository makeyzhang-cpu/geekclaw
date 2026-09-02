/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import HubPageShell from '@renderer/components/layout/HubPageShell';
import WebviewHost from '@renderer/components/media/WebviewHost';
import { Globe, Left, LinkOut } from '@icon-park/react';
import { openExternalUrl } from '@/renderer/utils/platform';

/** AI 外贸工作台入口（GeekFlow） */
const FOREIGN_TRADE_URL = 'https://geekflow.geekclaw.ai/login';

/**
 * ForeignTradePage — AI 外贸工作台 hub.
 *
 * 右侧内容区直接链接到 GeekFlow 外贸工作台登录页
 * （https://geekflow.geekclaw.ai/login），并提供「在浏览器中打开」跳转；
 * 点击「进入平台」可在应用内 WebviewHost 内嵌打开，无需离开软件。
 */
const ForeignTradePage: React.FC = () => {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);
  const handleBack = useCallback(() => setActive(false), []);

  // 入口选择视图
  if (!active) {
    return (
      <HubPageShell
        title={t('foreignTrade.title', { defaultValue: 'AI外贸工作台' })}
        subtitle={t('foreignTrade.subtitle', {
          defaultValue:
            '聚合AI外贸专家团队、AI获客Agent、千人千面的AI邮件触达和AI WhatsApp触达、AI CRM、AI企业智脑、企业数字资产管理为一体，一站式B2B外贸AI工作平台。',
        })}
        maxWidthClass='md:max-w-1600px'
      >
        <div className='space-y-24px'>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-16px'>
            <button
              onClick={() => setActive(true)}
              className='group text-left cursor-pointer border border-[var(--color-border-2)] rounded-12px bg-[var(--color-bg-2)] p-24px transition-all hover:border-primary-6 hover:shadow-[0_4px_16px_rgba(var(--primary-6),0.14)]'
            >
              <div className='flex items-start justify-between'>
                <span className='size-40px flex items-center justify-center rounded-10px bg-primary-1 text-primary-6'>
                  <Globe theme='outline' size='24' fill='currentColor' />
                </span>
                <span className='text-12px leading-18px px-8px py-2px rounded-full bg-fill-2 text-t-tertiary'>
                  {t('foreignTrade.badge', { defaultValue: '外贸' })}
                </span>
              </div>
              <h2 className='mt-16px text-16px font-600 text-t-primary'>{t('foreignTrade.cardTitle', { defaultValue: 'GeekFlow 外贸工作台' })}</h2>
              <p className='mt-8px text-13px leading-20px text-t-secondary'>{t('foreignTrade.cardDesc', { defaultValue: 'AI驱动B2B外贸自动化获客、AI邮件和AIWhatsApp精准触达自动化' })}</p>
              <div className='mt-16px flex items-center gap-12px'>
                <span className='text-13px font-500 text-primary-6 group-hover:underline'>
                  {t('foreignTrade.enter', { defaultValue: '进入平台' })} →
                </span>
                <span
                  role='button'
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    openExternalUrl(FOREIGN_TRADE_URL);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      openExternalUrl(FOREIGN_TRADE_URL);
                    }
                  }}
                  className='inline-flex items-center gap-4px text-12px text-t-tertiary hover:text-primary-6 cursor-pointer transition-colors'
                >
                  <LinkOut theme='outline' size={14} />
                  {t('foreignTrade.openExternal', { defaultValue: '在浏览器中打开' })}
                </span>
              </div>
            </button>
          </div>
        </div>
      </HubPageShell>
    );
  }

  // 内嵌视图
  return (
    <div className='w-full box-border px-12px md:px-24px py-24px'>
      <div className='mx-auto w-full md:max-w-1600px'>
        <div className='mb-12px flex items-center justify-between gap-8px'>
          <div className='flex items-center gap-8px'>
            <button
              onClick={handleBack}
              className='flex items-center gap-4px text-13px text-t-secondary hover:text-primary-6 cursor-pointer transition-colors'
            >
              <Left theme='outline' size={16} />
              {t('foreignTrade.back', { defaultValue: '返回' })}
            </button>
            <span className='text-14px font-600 text-t-primary'>{t('foreignTrade.cardTitle', { defaultValue: 'GeekFlow 外贸工作台' })}</span>
          </div>
          <button
            onClick={() => openExternalUrl(FOREIGN_TRADE_URL)}
            className='inline-flex items-center gap-6px px-12px py-6px text-12px font-500 text-primary-6 border border-primary-6 rounded-8px hover:bg-primary-1 cursor-pointer transition-colors'
          >
            <LinkOut theme='outline' size={14} />
            {t('foreignTrade.openExternal', { defaultValue: '在浏览器中打开' })}
          </button>
        </div>
        <div className='h-[calc(100vh-120px)] min-h-480px border border-[var(--color-border-2)] rounded-12px overflow-hidden bg-[var(--color-bg-2)]'>
          <WebviewHost key='foreign-trade' url={FOREIGN_TRADE_URL} showNavBar />
        </div>
      </div>
    </div>
  );
};

export default ForeignTradePage;
