/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A2AStorefrontPage v2 — A2A 跨境电商独立站（阿里橙主题）。
 *
 * 参考 ukenmall.com 三栏布局 + 阿里橙视觉：
 * - 左：品牌 Logo + Hero 大标题 + 多语言切换器
 * - 中：精选商品网格 + AI 推荐
 * - 右：商家 Agent 入驻卡片 + 路线图
 *
 * 授权门禁（云端管理后台统一授权）：未授权 → 🔒 开通引导。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Spin } from '@arco-design/web-react';
import { ArrowRight, Refresh, Shop } from '@icon-park/react';
import { PRODUCTS, type A2AProduct } from '../A2APlatformPage/catalog';
import { isDemoMode, loadStorefrontAccess, type StorefrontAccessState } from '../A2APlatformPage/cloudApi';
import { getLocale, loadLocale, type LocaleCode, CURRENCY_SYMBOL } from '../A2APlatformPage/localization';
import { loadSelectedModel } from '../A2APlatformPage/models';
import ProductCard from '../A2APlatformPage/components/ProductCard';
import LanguageSwitcher from '../A2APlatformPage/components/LanguageSwitcher';
import ProductAnalysisModal from '../A2APlatformPage/components/ProductAnalysisModal';
import { A2A_THEME, A2A_HERO_GRADIENT } from '../A2APlatformPage/theme';

const A2AStorefrontPage: React.FC = () => {
  const { t } = useTranslation();

  // 授权门禁
  const [access, setAccess] = useState<StorefrontAccessState | null>(null);
  const [checking, setChecking] = useState(true);

  // 本地化状态
  const [localeCode, setLocaleCode] = useState<LocaleCode>(() => loadLocale());
  const localeInfo = useMemo(() => getLocale(localeCode), [localeCode]);
  const model = useMemo(() => loadSelectedModel(), []);

  // 弹窗
  const [analyzeProduct, setAnalyzeProduct] = useState<A2AProduct | null>(null);

  const checkAccess = useCallback(async () => {
    setChecking(true);
    try {
      const state = await loadStorefrontAccess();
      setAccess(state);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkAccess();
  }, [checkAccess]);

  const featuredProducts = useMemo(() => PRODUCTS.slice(0, 8), []);

  const roadmap = [
    { icon: '🤝', key: 'agent' },
    { icon: '⚖️', key: 'trust' },
    { icon: '🔗', key: 'x402' },
    { icon: '🌐', key: 'geo' },
  ] as const;

  // ── 授权门禁：未授权 / 未登录 / 云端不可用时，展示引导而非内容 ──
  if (checking) {
    return (
      <div className='flex flex-col items-center justify-center gap-12px py-60px text-t-tertiary'>
        <Spin size={24} />
        <div className='text-13px'>{t('requirements.a2a.storefront.gate.checking')}</div>
      </div>
    );
  }

  if (access?.status !== 'authorized') {
    const isNotSignedIn = access?.status === 'not-signed-in';
    const isCloudUnavailable = access?.status === 'cloud-unavailable';
    return (
      <div className='flex flex-col items-center gap-16px py-40px px-24px'>
        <div
          className='flex flex-col items-center gap-12px rounded-20px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-28px text-center max-w-[520px]'
        >
          <div className='text-40px leading-none'>🔒</div>
          <div className='text-16px font-600 text-t-primary'>{t('requirements.a2a.storefront.gate.title')}</div>
          <div className='text-13px leading-22px text-t-secondary'>{t('requirements.a2a.storefront.gate.desc')}</div>

          {isNotSignedIn ? (
            <div className='w-full rounded-12px border border-solid border-[var(--color-warning-6)] bg-[color-mix(in_srgb,var(--color-warning-6)_8%,transparent)] p-12px text-12px leading-20px text-[var(--color-warning-6)]'>
              {t('requirements.a2a.storefront.gate.notSignedIn')}：{t('requirements.a2a.storefront.gate.notSignedInDesc')}
            </div>
          ) : null}

          {isCloudUnavailable ? (
            <div className='w-full rounded-12px border border-solid border-[var(--color-warning-6)] bg-[color-mix(in_srgb,var(--color-warning-6)_8%,transparent)] p-12px text-12px leading-20px text-[var(--color-warning-6)]'>
              {t('requirements.a2a.storefront.gate.cloudUnavailable')}：{t('requirements.a2a.storefront.gate.cloudUnavailableDesc')}
            </div>
          ) : null}

          <div className='flex items-center gap-8px mt-4px'>
            <Button type='primary' icon={<ArrowRight theme='outline' size='15' />} onClick={() => {}}>
              {t('requirements.a2a.storefront.gate.goAdmin')}
            </Button>
            <Button icon={<Refresh theme='outline' size='15' />} onClick={() => void checkAccess()}>
              {t('requirements.a2a.storefront.gate.retry')}
            </Button>
          </div>
          <div className='text-11px text-t-tertiary'>{t('requirements.a2a.storefront.gate.goAdminHint')}</div>
          {isDemoMode() ? <div className='text-11px text-[var(--color-warning-6)]'>{t('requirements.a2a.storefront.gate.demoHint')}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-20px' dir={localeInfo.rtl ? 'rtl' : 'ltr'}>
      {/* 顶部工具栏 */}
      <div className='flex items-center justify-between gap-12px flex-wrap'>
        <div className='flex items-center gap-10px'>
          <Shop theme='outline' size='20' className='text-primary-6' style={{ color: A2A_THEME.primary }} />
          <span className='text-15px font-600 text-t-primary'>
            {t('requirements.a2a.storefront.title')}
          </span>
        </div>
        <div className='flex items-center gap-10px'>
          <LanguageSwitcher onChange={setLocaleCode} />
        </div>
      </div>

      {/* Hero 大标题 */}
      <div
        className='flex flex-col items-center gap-16px px-24px py-36px rounded-24px'
        style={{ background: A2A_HERO_GRADIENT }}
      >
        <div className='inline-flex items-center gap-6px rounded-20px bg-[var(--color-primary-1)] px-12px py-4px text-12px font-600 text-[var(--color-primary-6)]'>
          🛍️ GeekClaw Commerce™ · 独立站
        </div>
        <h1 className='text-center text-32px sm:text-40px font-700 leading-tight text-t-primary tracking-tight max-w-[720px]'>
          {t('requirements.a2a.storefront.heroTitle')}
        </h1>
        <p className='text-center text-14px leading-24px text-t-secondary max-w-[640px]'>
          {t('requirements.a2a.storefront.subtitle')}
        </p>
        <div className='flex items-center gap-8px mt-6px'>
          <Button type='primary' size='large' icon={<ArrowRight theme='outline' size='15' />}>
            {t('requirements.a2a.storefront.apply')}
          </Button>
          <span className='text-12px text-t-tertiary'>{t('requirements.a2a.storefront.comingSoon')}</span>
        </div>
      </div>

      {/* IP 壁垒叙事 */}
      <div
        className='rounded-20px p-20px flex flex-col gap-10px'
        style={{ background: A2A_THEME.primarySoft }}
      >
        <div className='flex items-center gap-6px'>
          <span className='text-16px'>🛡️</span>
          <span className='text-14px font-700 text-t-primary'>
            {t('requirements.a2a.platform.ip.title')}
          </span>
        </div>
        <div className='text-13px leading-22px text-t-secondary'>
          {t('requirements.a2a.platform.ip.body')}
        </div>
      </div>

      {/* 精选商品 */}
      <section className='flex flex-col gap-12px'>
        <div className='flex items-baseline justify-between'>
          <h2 className='text-18px font-700 text-t-primary flex items-center gap-6px'>
            <span style={{ color: A2A_THEME.primary }}>●</span>
            {t('requirements.a2a.storefront.catalogTitle')}
          </h2>
          <span className='text-12px text-t-tertiary'>
            {t('requirements.a2a.storefront.count', { count: PRODUCTS.length })}
          </span>
        </div>
        <div className='grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-12px'>
          {featuredProducts.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              region={localeInfo.region}
              currency={localeInfo.currency}
              onAnalyze={setAnalyzeProduct}
              onBuy={() => {
                /* 独立站模式下暂不直接下单，引导到平台页 */
              }}
            />
          ))}
        </div>
      </section>

      {/* 商家入驻 + 路线图 */}
      <div className='grid grid-cols-1 md:grid-cols-2 gap-16px'>
        <div className='rounded-20px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-20px flex flex-col gap-10px'>
          <div className='text-15px font-600 text-t-primary'>🏪 {t('requirements.a2a.storefront.merchantTitle')}</div>
          <div className='text-13px leading-22px text-t-secondary'>{t('requirements.a2a.storefront.merchantDesc')}</div>
          <div className='flex flex-wrap gap-8px pt-2px'>
            <Button type='primary' icon={<ArrowRight theme='outline' size='15' />}>
              {t('requirements.a2a.storefront.apply')}
            </Button>
            <span className='inline-flex items-center text-12px text-t-tertiary pl-4px'>
              {t('requirements.a2a.storefront.comingSoon')}
            </span>
          </div>
        </div>

        <div className='rounded-20px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-20px flex flex-col gap-10px'>
          <div className='text-15px font-600 text-t-primary'>🗺️ {t('requirements.a2a.storefront.roadmapTitle')}</div>
          <div className='grid grid-cols-2 gap-10px'>
            {roadmap.map((r) => (
              <div key={r.key} className='flex items-start gap-8px rounded-12px bg-[var(--color-fill-1)] p-12px'>
                <span className='text-20px leading-none flex-none'>{r.icon}</span>
                <div className='flex flex-col gap-2px min-w-0'>
                  <span className='text-12px font-600 text-t-primary'>{t(`requirements.a2a.storefront.roadmap.${r.key}.title`)}</span>
                  <span className='text-11px leading-18px text-t-tertiary line-clamp-2'>{t(`requirements.a2a.storefront.roadmap.${r.key}.desc`)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 当前模型 + 货币状态条 */}
      <div className='flex items-center justify-between gap-12px rounded-16px bg-[var(--color-fill-1)] px-16px py-12px text-11px text-t-tertiary'>
        <span>
          {t('requirements.a2a.platform.live.model')}：<span className='font-600 text-t-primary'>{model.name}</span>
        </span>
        <span>
          {t('requirements.a2a.platform.live.locale')}：<span className='font-600 text-t-primary'>{localeInfo.nativeLabel}</span> · {CURRENCY_SYMBOL[localeInfo.currency]}
        </span>
      </div>

      {/* AI 多维解构弹窗 */}
      <ProductAnalysisModal
        product={analyzeProduct}
        model={model}
        analysisProfile={localeInfo.analysisProfile}
        onClose={() => setAnalyzeProduct(null)}
      />
    </div>
  );
};

export default A2AStorefrontPage;