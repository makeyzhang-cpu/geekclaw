/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { LinkOut } from '@icon-park/react';
import WebviewHost from '@renderer/components/media/WebviewHost';
import { openExternalUrl } from '@/renderer/utils/platform';

/** 国内 GEO AI 营销平台入口（原 AI品牌营销 hub 的国内卡片，独立成侧栏板块） */
const DOMESTIC_GEO_URL = 'https://geekgeo.jkyunge.com/';

/**
 * GeoDomesticPage — 国内GEO AI营销。
 *
 * 点击侧栏【国内GEO AI营销】直接在应用内 webview 打开平台，顶部提供
 * 「在浏览器中打开」快捷出口；无二级卡片页。
 */
const GeoDomesticPage: React.FC = () => {
  const { t } = useTranslation();
  const title = t('geoDomestic.title', { defaultValue: '国内GEO AI营销' });

  return (
    <div className='w-full box-border px-12px md:px-24px py-24px'>
      <div className='mx-auto w-full md:max-w-1600px'>
        <div className='mb-12px flex items-center justify-between gap-8px'>
          <span className='text-14px font-600 text-t-primary'>{title}</span>
          <button
            onClick={() => openExternalUrl(DOMESTIC_GEO_URL)}
            className='inline-flex items-center gap-6px px-12px py-6px text-12px font-500 text-primary-6 border border-primary-6 rounded-8px hover:bg-primary-1 cursor-pointer transition-colors'
          >
            <LinkOut theme='outline' size={14} />
            {t('geoDomestic.openExternal', { defaultValue: '在浏览器中打开' })}
          </button>
        </div>
        <div className='h-[calc(100vh-120px)] min-h-480px border border-[var(--color-border-2)] rounded-12px overflow-hidden bg-[var(--color-bg-2)]'>
          <WebviewHost key='geo-domestic' url={DOMESTIC_GEO_URL} showNavBar />
        </div>
      </div>
    </div>
  );
};

export default GeoDomesticPage;
