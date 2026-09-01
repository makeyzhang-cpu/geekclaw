/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A2A 本土化大脑（Localization Brain™）。
 *
 * 知识产权壁垒：
 * - 11 种语言覆盖全球主要出海市场
 * - 自动按地区切换货币 + 解构风格（中文偏"性价比"，日韩偏"工艺"，欧美偏"风格/历史"）
 * - RTL 支持（阿拉伯语）
 * - 区域支付方式聚合（微信/支付宝/Stripe/PayPal）
 *
 * 真实汇率需从云端拉取，本地 mock 写死合理汇率（2026 Q2 估值）。
 */

export type LocaleCode =
  | 'zh-CN'
  | 'en-US'
  | 'ja-JP'
  | 'ko-KR'
  | 'de-DE'
  | 'es-ES'
  | 'fr-FR'
  | 'pt-PT'
  | 'it-IT'
  | 'ru-RU'
  | 'ar-SA';

export interface LocaleInfo {
  code: LocaleCode;
  /** 显示用中文名（如"中文"） */
  label: string;
  /** 显示用本地名（如"English"） */
  nativeLabel: string;
  /** 国旗 emoji */
  flag: string;
  /** 货币代码 */
  currency: CurrencyCode;
  /** 是否 RTL（从右到左） */
  rtl: boolean;
  /** 区域代码（推荐商品时的优先产地） */
  region: 'CN' | 'JP' | 'KR' | 'EU' | 'US' | 'GLOBAL';
  /** 可用支付方式 */
  payments: PaymentMethod[];
  /** 商品解构维度侧重 */
  analysisProfile: 'value' | 'craft' | 'style' | 'mixed';
}

export type CurrencyCode = 'CNY' | 'USD' | 'EUR' | 'JPY' | 'KRW' | 'RUB' | 'GBP' | 'HKD';

export type PaymentMethod = 'wechat' | 'alipay' | 'stripe' | 'paypal' | 'local';

/** mock 汇率（相对 CNY，2026 Q2 估值）。生产应从云端 /api/fx/rates 拉。 */
const FX_RATES: Record<CurrencyCode, number> = {
  CNY: 1,
  USD: 0.139,    // 1 CNY ≈ 0.139 USD
  EUR: 0.128,    // 1 CNY ≈ 0.128 EUR
  JPY: 21.5,     // 1 CNY ≈ 21.5 JPY
  KRW: 191,      // 1 CNY ≈ 191 KRW
  RUB: 12.8,     // 1 CNY ≈ 12.8 RUB
  GBP: 0.109,
  HKD: 1.09,
};

export const CURRENCY_SYMBOL: Record<CurrencyCode, string> = {
  CNY: '¥',
  USD: '$',
  EUR: '€',
  JPY: '¥',
  KRW: '₩',
  RUB: '₽',
  GBP: '£',
  HKD: 'HK$',
};

/** 货币小数位（CNY/USD/EUR 2 位，JPY/KRW/RUB 0 位）。 */
const CURRENCY_DECIMALS: Record<CurrencyCode, number> = {
  CNY: 0,
  USD: 2,
  EUR: 2,
  JPY: 0,
  KRW: 0,
  RUB: 0,
  GBP: 2,
  HKD: 2,
};

export const LOCALES: LocaleInfo[] = [
  {
    code: 'zh-CN',
    label: '中文',
    nativeLabel: '中文',
    flag: '🇨🇳',
    currency: 'CNY',
    rtl: false,
    region: 'CN',
    payments: ['wechat', 'alipay'],
    analysisProfile: 'value',
  },
  {
    code: 'en-US',
    label: 'English',
    nativeLabel: 'English',
    flag: '🇺🇸',
    currency: 'USD',
    rtl: false,
    region: 'US',
    payments: ['stripe', 'paypal'],
    analysisProfile: 'style',
  },
  {
    code: 'ja-JP',
    label: '日本語',
    nativeLabel: '日本語',
    flag: '🇯🇵',
    currency: 'JPY',
    rtl: false,
    region: 'JP',
    payments: ['stripe', 'local'],
    analysisProfile: 'craft',
  },
  {
    code: 'ko-KR',
    label: '한국어',
    nativeLabel: '한국어',
    flag: '🇰🇷',
    currency: 'KRW',
    rtl: false,
    region: 'KR',
    payments: ['stripe', 'local'],
    analysisProfile: 'craft',
  },
  {
    code: 'de-DE',
    label: 'Deutsch',
    nativeLabel: 'Deutsch',
    flag: '🇩🇪',
    currency: 'EUR',
    rtl: false,
    region: 'EU',
    payments: ['stripe', 'paypal'],
    analysisProfile: 'style',
  },
  {
    code: 'es-ES',
    label: 'Español',
    nativeLabel: 'Español',
    flag: '🇪🇸',
    currency: 'EUR',
    rtl: false,
    region: 'EU',
    payments: ['stripe', 'paypal'],
    analysisProfile: 'style',
  },
  {
    code: 'fr-FR',
    label: 'Français',
    nativeLabel: 'Français',
    flag: '🇫🇷',
    currency: 'EUR',
    rtl: false,
    region: 'EU',
    payments: ['stripe', 'paypal'],
    analysisProfile: 'style',
  },
  {
    code: 'pt-PT',
    label: 'Português',
    nativeLabel: 'Português',
    flag: '🇵🇹',
    currency: 'EUR',
    rtl: false,
    region: 'EU',
    payments: ['stripe', 'paypal'],
    analysisProfile: 'mixed',
  },
  {
    code: 'it-IT',
    label: 'Italiano',
    nativeLabel: 'Italiano',
    flag: '🇮🇹',
    currency: 'EUR',
    rtl: false,
    region: 'EU',
    payments: ['stripe', 'paypal'],
    analysisProfile: 'style',
  },
  {
    code: 'ru-RU',
    label: 'Русский',
    nativeLabel: 'Русский',
    flag: '🇷🇺',
    currency: 'RUB',
    rtl: false,
    region: 'GLOBAL',
    payments: ['local'],
    analysisProfile: 'value',
  },
  {
    code: 'ar-SA',
    label: 'العربية',
    nativeLabel: 'العربية',
    flag: '🇸🇦',
    currency: 'USD',
    rtl: true,
    region: 'GLOBAL',
    payments: ['local', 'stripe'],
    analysisProfile: 'mixed',
  },
];

export function getLocale(code: LocaleCode): LocaleInfo {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0];
}

/** 把 CNY 价格换算到目标货币。 */
export function convertCurrency(cnyAmount: number, target: CurrencyCode): number {
  const rate = FX_RATES[target] ?? 1;
  return cnyAmount * rate;
}

/** 格式化金额：货币符号 + 数字 + 千分位。 */
export function formatPrice(cnyAmount: number, currency: CurrencyCode): string {
  const amount = convertCurrency(cnyAmount, currency);
  const decimals = CURRENCY_DECIMALS[currency];
  const symbol = CURRENCY_SYMBOL[currency];
  const rounded = decimals === 0 ? Math.round(amount).toLocaleString() : amount.toFixed(decimals);
  return `${symbol}${rounded}`;
}

/** 持久化用户选择的语言。 */
const LOCALE_STORAGE_KEY = 'a2a:locale';

export function loadLocale(): LocaleCode {
  if (typeof window === 'undefined') return 'zh-CN';
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (stored && LOCALES.some((l) => l.code === stored)) return stored as LocaleCode;
  return 'zh-CN';
}

export function saveLocale(code: LocaleCode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LOCALE_STORAGE_KEY, code);
}