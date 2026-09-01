/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import HubPageShell from '@renderer/components/layout/HubPageShell';
import WebviewHost from '@renderer/components/media/WebviewHost';
import { Aiming, Globe, Left, LinkOut } from '@icon-park/react';
import YanxiQrcode from '@/renderer/assets/images/yanxi-qrcode.png';
import { openExternalUrl } from '@/renderer/utils/platform';

/** 国内 GEO AI 营销平台入口 */
const DOMESTIC_GEO_URL = 'https://geekgeo.jkyunge.com/';
/** 国际 GEO AI 营销平台入口 */
const INTERNATIONAL_GEO_URL = 'https://orbitai.jkyunge.com/';

type GeoEntryKey = 'domestic' | 'international';

interface GeoEntry {
  key: GeoEntryKey;
  title: string;
  description: string;
  url: string;
  badge: string;
}

/**
 * WorkCommunityPage — AI 品牌营销 hub.
 *
 * 聚合 GeekClaw 的 GEO 营销能力入口：国内 GEO（geekgeo.jkyunge.com）与
 * 国际 GEO（orbitai.jkyunge.com）。点击功能卡片后在同一页面内嵌
 * WebviewHost 打开对应平台，无需离开软件即可使用。
 */
const WorkCommunityPage: React.FC = () => {
  const { t } = useTranslation();
  const [activeEntry, setActiveEntry] = useState<GeoEntryKey | null>(null);

  const entries: GeoEntry[] = [
    {
      key: 'domestic',
      title: t('workCommunity.domesticTitle', { defaultValue: '国内GEO AI营销' }),
      description: t('workCommunity.domesticDesc', {
        defaultValue:
          '面向国内市场的 AI 搜索引擎优化（GEO）——让品牌在 DeepSeek、Kimi、豆包等 AI 助手回答问题时被看见、被信任、被找到。',
      }),
      url: DOMESTIC_GEO_URL,
      badge: t('workCommunity.domesticBadge', { defaultValue: '国内' }),
    },
    {
      key: 'international',
      title: t('workCommunity.internationalTitle', { defaultValue: '国际GEO AI营销' }),
      description: t('workCommunity.internationalDesc', {
        defaultValue:
          '多语种 AI 独立站 + AI SEO + AI GEO——企业出海必做海外 GEO，让全球精准买家在问 AI 的时候看见你、相信你、找到你。',
      }),
      url: INTERNATIONAL_GEO_URL,
      badge: t('workCommunity.internationalBadge', { defaultValue: '出海' }),
    },
  ];

  const active = entries.find((e) => e.key === activeEntry);
  const handleBack = useCallback(() => setActiveEntry(null), []);

  // 入口选择视图
  if (!active) {
    return (
      <HubPageShell
        title={t('workCommunity.title', { defaultValue: 'AI品牌营销' })}
        subtitle={t('workCommunity.subtitle', {
          defaultValue:
            'AI 获客与数字资产沉淀，全球多语种 AI 独立站+AI SEO+AI GEO，企业出海一定做海外GEO，让全球精准买家在问AI的时候，看见你、相信你、找到你。',
        })}
        maxWidthClass='md:max-w-1600px'
      >
        <div className='space-y-24px'>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-16px'>
            {entries.map((entry) => {
              const Icon = entry.key === 'domestic' ? Aiming : Globe;
              return (
                <button
                  key={entry.key}
                  onClick={() => setActiveEntry(entry.key)}
                  className='group text-left cursor-pointer border border-[var(--color-border-2)] rounded-12px bg-[var(--color-bg-2)] p-24px transition-all hover:border-primary-6 hover:shadow-[0_4px_16px_rgba(var(--primary-6),0.14)]'
                >
                  <div className='flex items-start justify-between'>
                    <span className='size-40px flex items-center justify-center rounded-10px bg-primary-1 text-primary-6'>
                      <Icon theme='outline' size='24' fill='currentColor' />
                    </span>
                    <span className='text-12px leading-18px px-8px py-2px rounded-full bg-fill-2 text-t-tertiary'>
                      {entry.badge}
                    </span>
                  </div>
                  <h2 className='mt-16px text-16px font-600 text-t-primary'>{entry.title}</h2>
                  <p className='mt-8px text-13px leading-20px text-t-secondary'>{entry.description}</p>
                  <div className='mt-16px flex items-center gap-12px'>
                    <span className='text-13px font-500 text-primary-6 group-hover:underline'>
                      {t('workCommunity.enter', { defaultValue: '进入平台' })} →
                    </span>
                    <span
                      role='button'
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        openExternalUrl(entry.url);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          openExternalUrl(entry.url);
                        }
                      }}
                      className='inline-flex items-center gap-4px text-12px text-t-tertiary hover:text-primary-6 cursor-pointer transition-colors'
                    >
                      <LinkOut theme='outline' size={14} />
                      {t('workCommunity.openExternal', { defaultValue: '在浏览器中打开' })}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* 合规承诺 + 二维码 */}
          <div className='flex flex-col md:flex-row items-start md:items-center justify-between gap-24px border border-[var(--color-border-2)] rounded-12px bg-[var(--color-bg-2)] p-24px'>
            <div className='flex-1'>
              <div className='flex items-center gap-8px mb-12px'>
                <span className='size-6px rounded-full bg-[#ff6a00]' />
                <span className='text-12px font-500 text-[#ff6a00]'>合规承诺</span>
              </div>
              <h3 className='text-18px md:text-20px font-600 text-[#ff6a00] leading-28px'>
                坚守合规底线，让企业真实价值被 AI 准确理解
              </h3>
              <p className='mt-12px text-13px leading-22px text-t-secondary max-w-2xl'>
                全部AI优化会基于企业现有资质、产品优势和服务实绩，通过结构化数据标注与合规内容治理，帮助 AI 搜索引擎准确抓取、理解并推荐您的真实商业价值。
              </p>
              <p className='mt-16px text-13px font-500 text-[#ff6a00]'>
                更多资讯请咨询言曦引擎服务商
              </p>
            </div>
            <div className='shrink-0 flex flex-col items-center gap-8px'>
              <img
                src={YanxiQrcode}
                alt='言曦引擎服务商二维码'
                className='w-36 h-36 object-contain rounded-8px border border-[var(--color-border-2)]'
              />
              <span className='text-11px text-t-tertiary'>扫码联系言曦引擎服务商</span>
            </div>
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
              {t('workCommunity.back', { defaultValue: '返回' })}
            </button>
            <span className='text-14px font-600 text-t-primary'>{active.title}</span>
          </div>
          <button
            onClick={() => openExternalUrl(active.url)}
            className='inline-flex items-center gap-6px px-12px py-6px text-12px font-500 text-primary-6 border border-primary-6 rounded-8px hover:bg-primary-1 cursor-pointer transition-colors'
          >
            <LinkOut theme='outline' size={14} />
            {t('workCommunity.openExternal', { defaultValue: '在浏览器中打开' })}
          </button>
        </div>
        <div className='h-[calc(100vh-120px)] min-h-480px border border-[var(--color-border-2)] rounded-12px overflow-hidden bg-[var(--color-bg-2)]'>
          <WebviewHost key={active.key} url={active.url} showNavBar />
        </div>
      </div>
    </div>
  );
};

export default WorkCommunityPage;
