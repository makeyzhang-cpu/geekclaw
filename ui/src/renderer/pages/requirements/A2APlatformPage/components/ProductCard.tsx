/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { ShoppingCart } from '@icon-park/react';
import { A2AProduct } from '../catalog';
import { A2A_THEME } from '../theme';
import { CurrencyCode, formatPrice } from '../localization';

interface Props {
  product: A2AProduct;
  /** 当前用户区域（决定推荐标签） */
  region: 'CN' | 'JP' | 'KR' | 'EU' | 'US' | 'GLOBAL';
  /** 当前货币 */
  currency: CurrencyCode;
  /** 是否显示"UKEN 推荐" / "适合旅行" 标签 */
  showTags?: boolean;
  /** 点击"详情"（打开 AI 多维分析） */
  onAnalyze: (p: A2AProduct) => void;
  /** 点击"购买" */
  onBuy: (p: A2AProduct) => void;
}

/**
 * 商品卡片（4 列网格用）。
 * 设计要点：
 * - 顶部标签（UKEN 推荐 / 适合旅行 / 跨境直邮）
 * - 商品名 + 一句话描述
 * - 大字号本地化价格
 * - 详情（AI 解构） + 购买（主按钮）
 */
const ProductCard: React.FC<Props> = ({ product, region, currency, showTags = true, onAnalyze, onBuy }) => {
  const { t } = useTranslation();

  // 按区域 + tags 推断推荐标签
  const tagText = (() => {
    if (!showTags) return null;
    if (product.tags.some((tag) => tag.includes('旅行') || tag.includes('旅游'))) {
      return { text: t('requirements.a2a.platform.product.tagTravel'), color: '#52C41A' };
    }
    if (region === 'JP' || region === 'KR') {
      return { text: t('requirements.a2a.platform.product.tagCraft'), color: '#9254DE' };
    }
    if (region === 'EU' || region === 'US') {
      return { text: t('requirements.a2a.platform.product.tagStyle'), color: '#1890FF' };
    }
    return { text: t('requirements.a2a.platform.product.tagPicked'), color: A2A_THEME.primary };
  })();

  return (
    <div className='flex flex-col gap-10px rounded-16px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-1)] p-14px transition-all duration-200 hover:border-[var(--color-primary-4)] hover:shadow-[0_8px_24px_rgba(255,106,0,0.10)] hover:-translate-y-2px'>
      {/* 商品图占位 */}
      <div className='relative w-full aspect-square rounded-12px overflow-hidden' style={{ background: 'linear-gradient(135deg, #FFF8F2 0%, #FFEFE0 100%)' }}>
        <div className='absolute inset-0 flex items-center justify-center text-t-tertiary text-13px'>
          📦 {product.id}
        </div>
        {tagText && (
          <div
            className='absolute top-8px left-8px inline-flex items-center rounded-16px px-10px py-3px text-11px font-600'
            style={{ background: tagText.color, color: '#FFFFFF' }}
          >
            {tagText.text}
          </div>
        )}
        <div className='absolute top-8px right-8px inline-flex items-center justify-center w-28px h-28px rounded-14px bg-[color-mix(in_srgb,var(--color-bg-1)_85%,transparent)] cursor-pointer hover:bg-[var(--color-bg-1)] transition-colors'>
          <ShoppingCart theme='outline' size='14' className='text-t-secondary' />
        </div>
      </div>

      {/* 商品名 + 描述 */}
      <div className='flex flex-col gap-4px'>
        <div className='text-14px font-600 text-t-primary line-clamp-2 leading-tight'>
          {product.name}
        </div>
        <div className='text-11px text-t-tertiary line-clamp-2 leading-tight'>
          {product.tags.join(' · ')}
        </div>
      </div>

      {/* 价格 */}
      <div className='text-16px font-700 text-t-primary'>
        {formatPrice(product.price_cny, currency)}
      </div>

      {/* 操作按钮 */}
      <div className='flex gap-8px mt-auto'>
        <button
          type='button'
          onClick={() => onAnalyze(product)}
          className='flex-1 rounded-999px border border-solid border-[var(--color-border-3)] bg-transparent text-t-secondary text-12px py-7px cursor-pointer transition-colors hover:border-[var(--color-primary-5)] hover:text-[var(--color-primary-6)]'
        >
          {t('requirements.a2a.platform.product.detail')}
        </button>
        <button
          type='button'
          onClick={() => onBuy(product)}
          className='flex-1 rounded-999px border-none text-12px py-7px font-600 cursor-pointer transition-opacity hover:opacity-90'
          style={{ background: A2A_THEME.primary, color: A2A_THEME.onPrimary }}
        >
          {t('requirements.a2a.platform.product.buy')}
        </button>
      </div>
    </div>
  );
};

export default ProductCard;