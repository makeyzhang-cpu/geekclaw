/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import HubPageShell from '@renderer/components/layout/HubPageShell';
import WebviewHost from '@renderer/components/media/WebviewHost';
import { Film, Left, LinkOut, VideoTwo } from '@icon-park/react';
import { openExternalUrl } from '@/renderer/utils/platform';

/** 创意工坊 — 视频/AI 内容创作平台入口（video.geekclaw.ai） */
const WORKSHOP_URL = 'https://video.geekclaw.ai/';

/**
 * WorkshopHomePage — 创意工坊入口页（5.0.26 重构）。
 *
 * 把创意工坊从一个本地 ComingSoon 占位，改为跳转到云端视频/AI 内容创作平台
 * （https://video.geekclaw.ai/）。提供两个入口：
 *   - 进入平台：在应用内 WebviewHost 内嵌打开（无需离开软件）
 *   - 在浏览器中打开：调用系统默认浏览器打开
 *
 * 旧的 /workshop/:id 路由继续指向原 WorkshopListPage（保留 deep link 兼容），
 * 本页只接管 /workshop 路由。
 */
const WorkshopHomePage: React.FC = () => {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);
  const handleBack = useCallback(() => setActive(false), []);

  // 入口选择视图
  if (!active) {
    return (
      <HubPageShell
        title={t('workshop.home.title', { defaultValue: '创意工坊' })}
        subtitle={t('workshop.home.subtitle', {
          defaultValue:
            'AI 视频生成 / 文生视频 / 图生视频 / 数字人短片 — 一站式云端内容创作工作台。在 GeekClaw 内直接打开，无需切换软件。',
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
                  <VideoTwo theme='outline' size='24' fill='currentColor' />
                </span>
                <span className='text-12px leading-18px px-8px py-2px rounded-full bg-fill-2 text-t-tertiary'>
                  {t('workshop.home.badge', { defaultValue: '云端' })}
                </span>
              </div>
              <h2 className='mt-16px text-16px font-600 text-t-primary'>
                {t('workshop.home.cardTitle', { defaultValue: 'video.geekclaw.ai — 创意工坊' })}
              </h2>
              <p className='mt-8px text-13px leading-20px text-t-secondary'>
                {t('workshop.home.cardDesc', {
                  defaultValue: 'AI 短视频 · 数字人 · 文生视频 · 图生视频 · 多镜头脚本编排',
                })}
              </p>
              <div className='mt-16px flex items-center gap-12px'>
                <span className='text-13px font-500 text-primary-6 group-hover:underline'>
                  {t('workshop.home.enter', { defaultValue: '进入平台' })} →
                </span>
                <span
                  role='button'
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    openExternalUrl(WORKSHOP_URL);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      openExternalUrl(WORKSHOP_URL);
                    }
                  }}
                  className='inline-flex items-center gap-4px text-12px text-t-tertiary hover:text-primary-6 cursor-pointer transition-colors'
                >
                  <LinkOut theme='outline' size={14} />
                  {t('workshop.home.openExternal', { defaultValue: '在浏览器中打开' })}
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
              {t('workshop.home.back', { defaultValue: '返回' })}
            </button>
            <span className='text-14px font-600 text-t-primary'>
              {t('workshop.home.cardTitle', { defaultValue: 'video.geekclaw.ai — 创意工坊' })}
            </span>
          </div>
          <button
            onClick={() => openExternalUrl(WORKSHOP_URL)}
            className='inline-flex items-center gap-6px px-12px py-6px text-12px font-500 text-primary-6 border border-primary-6 rounded-8px hover:bg-primary-1 cursor-pointer transition-colors'
          >
            <LinkOut theme='outline' size={14} />
            {t('workshop.home.openExternal', { defaultValue: '在浏览器中打开' })}
          </button>
        </div>
        <div className='h-[calc(100vh-120px)] min-h-480px border border-[var(--color-border-2)] rounded-12px overflow-hidden bg-[var(--color-bg-2)]'>
          <WebviewHost key='workshop' url={WORKSHOP_URL} showNavBar />
        </div>
      </div>
    </div>
  );
};

export default WorkshopHomePage;
