/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A2A 跨境电商 v2 设计令牌（阿里橙主题，品牌色 #FF6A00）。
 *
 * 主色：阿里橙 + 墨黑文本 + 暖白背景，所有色值都通过 CSS 变量注入
 * （覆盖 Arco Design 的 primary-6 等），便于在深浅主题下统一切换。
 */

export interface A2ADesignTokens {
  /** 主色（按钮、强调、链接） */
  primary: string;
  /** 主色弱化（hover、chip 背景） */
  primarySoft: string;
  /** 主色更深（按下、激活） */
  primaryStrong: string;
  /** 主色文字（白底主色按钮上的文字） */
  onPrimary: string;
  /** 墨黑文本（标题、Hero 文字） */
  ink: string;
  /** 灰色文本（正文） */
  textSecondary: string;
  /** 浅灰文本（提示、辅助） */
  textTertiary: string;
  /** 页面背景 */
  pageBackground: string;
  /** 卡片背景 */
  surface: string;
  /** 卡片边框 */
  border: string;
  /** 阴影 */
  shadowCard: string;
  /** 圆角（卡片） */
  radiusCard: string;
  /** 圆角（按钮） */
  radiusButton: string;
}

export const A2A_THEME: A2ADesignTokens = {
  primary: '#FF6A00',
  primarySoft: '#FFF3E8',
  primaryStrong: '#E05200',
  onPrimary: '#FFFFFF',
  ink: '#0F1419',
  textSecondary: '#3A3F47',
  textTertiary: '#7A8087',
  pageBackground: '#FFF9F5',
  surface: '#FFFFFF',
  border: '#F0E4D8',
  shadowCard: '0 4px 14px rgba(255, 106, 0, 0.08)',
  radiusCard: '16px',
  radiusButton: '999px',
};

/** 主色更浅的 chip 背景。 */
export const A2A_CHIP_BG = '#FFF6EE';
/** 主色高亮渐变（Hero 背景） */
export const A2A_HERO_GRADIENT =
  'linear-gradient(135deg, #FFF8F2 0%, #FFF1E5 50%, #FFF6EE 100%)';
/** Live 红点 */
export const A2A_LIVE_RED = '#FF3B30';
/** 微信支付绿 */
export const A2A_WECHAT_GREEN = '#07C160';
/** 支付宝蓝 */
export const A2A_ALIPAY_BLUE = '#1677FF';
/** Stripe 紫 */
export const A2A_STRIPE_PURPLE = '#635BFF';
/** PayPal 蓝 */
export const A2A_PAYPAL_BLUE = '#003087';