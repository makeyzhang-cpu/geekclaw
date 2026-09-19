/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Static catalog of GeekClaw 办公盒子 plan tiers + the feature comparison
 * matrix + the shared edge-computing box spec.
 *
 * Single source of truth: 《GeekClawAI办公盒子各版本服务表》. Every number and
 * every ✓/— in here traces back to that document — do NOT round, re-derive or
 * "simplify" them:
 *
 *   - Monthly and yearly prices are stored SEPARATELY on purpose. The document's
 *     annual prices do NOT follow one uniform discount (980→9800 ≈ 16.7% off,
 *     1500→15800 ≈ 12.2%, 5500→59800 ≈ 9.4%), so a `monthly × (1 - d)` formula
 *     would produce wrong numbers. Never reintroduce a YEARLY_DISCOUNT constant.
 *   - The matrix keeps the document's three states: `true` = √ (feature
 *     included), `'dev'` = 开发中 (in development), `false` = — (not included).
 *
 * All user-visible strings are language-neutral keys resolved on the page via
 * `t('pricing.<...>')`, so this file stays locale-agnostic.
 */

/** Storefront plan ids. 'free' is NOT here — it is a user-plan sentinel only. */
export type PlanId = 'basic' | 'geo' | 'trade-biz' | 'trade-ops' | 'trade-flagship';

export const PLAN_IDS: PlanId[] = ['basic', 'geo', 'trade-biz', 'trade-ops', 'trade-flagship'];

export interface PlanTier {
  id: PlanId;
  /** Per-month list price in CNY. */
  priceMonthly: number;
  /** Per-year list price in CNY (explicit — see file header). */
  priceYearly: number;
  /** The only tier that covers every feature row; gets the "all included" badge. */
  allIncluded: boolean;
  /** Where the card links when the user is not yet a subscriber. */
  ctaKey: 'pricing.cta.subscribe';
}

export const PLAN_TIERS: PlanTier[] = [
  { id: 'basic', priceMonthly: 980, priceYearly: 9800, allIncluded: false, ctaKey: 'pricing.cta.subscribe' },
  { id: 'geo', priceMonthly: 1500, priceYearly: 15800, allIncluded: false, ctaKey: 'pricing.cta.subscribe' },
  { id: 'trade-biz', priceMonthly: 3000, priceYearly: 29800, allIncluded: false, ctaKey: 'pricing.cta.subscribe' },
  { id: 'trade-ops', priceMonthly: 4000, priceYearly: 39800, allIncluded: false, ctaKey: 'pricing.cta.subscribe' },
  { id: 'trade-flagship', priceMonthly: 5500, priceYearly: 59800, allIncluded: true, ctaKey: 'pricing.cta.subscribe' },
];

export function findTier(id: string): PlanTier | undefined {
  return PLAN_TIERS.find((t) => t.id === id);
}

/** Yearly equivalent of a monthly-only view: what one month costs when billed yearly. */
export function yearlyPerMonth(tier: PlanTier): number {
  return Math.round(tier.priceYearly / 12);
}

/** How much a full year of yearly billing saves versus paying monthly for 12 months. */
export function yearlySaving(tier: PlanTier): number {
  return tier.priceMonthly * 12 - tier.priceYearly;
}

/* ------------------------------------------------------------------------- */
/* Feature comparison matrix                                                  */
/* ------------------------------------------------------------------------- */

/** `true` = √ 开通 · `'dev'` = 开发中 · `false` = — 无服务 */
export type FeatureState = boolean | 'dev';

export type FeatureGroupId = 'ai-general' | 'ai-trade' | 'ai-crossborder' | 'ai-marketing';

/**
 * Group ids in the order the document lists them. `rowSpan` is computed at
 * render time from consecutive rows sharing the same id, so adding a row never
 * means hand-editing a magic span number.
 */
export const FEATURE_GROUPS: FeatureGroupId[] = [
  'ai-general',
  'ai-trade',
  'ai-crossborder',
  'ai-marketing',
];

export interface PlanFeatureRow {
  /** Stable id; also the i18n key suffix under `pricing.matrix.<id>.d<N>`. */
  id: string;
  group: FeatureGroupId;
  /**
   * 功能介绍 label — resolved as `t('pricing.matrix.feature.<feature>')`.
   * Shared deliberately: the document merges one 功能介绍 cell across the
   * sibling rows of a workbench, so several rows carry the same value.
   */
  feature: string;
  /**
   * When true the cell's first detail line is the row's own headline (the
   * document merges one 功能详情 cell across sibling rows and uses the first
   * paragraph as that row's label). Rendered emphasised.
   */
  headline: boolean;
  /** Detail lines — i18n keys under `pricing.matrix.<id>.d1`, `.d2`, … */
  detailCount: number;
  values: Record<PlanId, FeatureState>;
}

const T = true;
const F = false;
const D: FeatureState = 'dev';

export const PLAN_FEATURE_ROWS: PlanFeatureRow[] = [
  {
    id: 'general',
    group: 'ai-general',
    feature: 'basicSetup',
    headline: false,
    detailCount: 9,
    values: { basic: T, geo: T, 'trade-biz': T, 'trade-ops': T, 'trade-flagship': T },
  },
  // — B2B外贸运营工作台 ×3（共用同一「功能介绍」单元格）—
  {
    id: 'opsTeam',
    group: 'ai-trade',
    feature: 'b2bOps',
    headline: true,
    detailCount: 1,
    values: { basic: F, geo: F, 'trade-biz': T, 'trade-ops': T, 'trade-flagship': T },
  },
  {
    id: 'opsSkill',
    group: 'ai-trade',
    feature: 'b2bOps',
    headline: true,
    detailCount: 1,
    values: { basic: F, geo: F, 'trade-biz': T, 'trade-ops': T, 'trade-flagship': T },
  },
  {
    id: 'opsOrbit',
    group: 'ai-trade',
    feature: 'b2bOps',
    headline: true,
    // headline + 3.1 ~ 3.8 = 9
    detailCount: 9,
    values: { basic: F, geo: F, 'trade-biz': F, 'trade-ops': T, 'trade-flagship': T },
  },
  // — B2B外贸业务工作台 ×3 —
  {
    id: 'bizTeam',
    group: 'ai-trade',
    feature: 'b2bSales',
    headline: true,
    detailCount: 1,
    values: { basic: F, geo: F, 'trade-biz': T, 'trade-ops': T, 'trade-flagship': T },
  },
  {
    id: 'bizSkill',
    group: 'ai-trade',
    feature: 'b2bSales',
    headline: true,
    detailCount: 1,
    values: { basic: F, geo: F, 'trade-biz': T, 'trade-ops': T, 'trade-flagship': T },
  },
  {
    id: 'bizGeeklink',
    group: 'ai-trade',
    feature: 'b2bSales',
    headline: true,
    // headline + 3.1 ~ 3.6 = 7
    detailCount: 7,
    values: { basic: F, geo: F, 'trade-biz': T, 'trade-ops': F, 'trade-flagship': T },
  },
  {
    id: 'crossborderA2a',
    group: 'ai-crossborder',
    feature: 'a2a',
    headline: false,
    detailCount: 2,
    values: { basic: D, geo: F, 'trade-biz': F, 'trade-ops': F, 'trade-flagship': F },
  },
  {
    id: 'crossborderOpc',
    group: 'ai-crossborder',
    feature: 'opc',
    headline: false,
    detailCount: 1,
    values: { basic: D, geo: F, 'trade-biz': F, 'trade-ops': F, 'trade-flagship': F },
  },
  {
    id: 'crossborderArt',
    group: 'ai-crossborder',
    feature: 'aiArt',
    headline: false,
    detailCount: 1,
    values: { basic: F, geo: F, 'trade-biz': F, 'trade-ops': F, 'trade-flagship': F },
  },
  {
    id: 'marketingGeo',
    group: 'ai-marketing',
    feature: 'domesticGeo',
    headline: false,
    detailCount: 10,
    values: { basic: F, geo: T, 'trade-biz': F, 'trade-ops': F, 'trade-flagship': F },
  },
];

/**
 * Row-span helper for the two leading columns of the matrix.
 *
 * Returns a parallel array where `groupSpan` / `featureSpan` are only non-zero
 * on the first row of each run (`0` = "covered by the cell above, render
 * nothing here"). `featureSpan` re-starts whenever either the group or the
 * 功能介绍 changes, which is what the document's merged cells express.
 */
export function computeMatrixSpans(rows: PlanFeatureRow[]): {
  groupSpan: number;
  featureSpan: number;
}[] {
  return rows.map((row, i) => {
    const prev = rows[i - 1];
    const next = rows[i + 1];
    const isGroupStart = !prev || prev.group !== row.group;
    const isFeatureStart = isGroupStart || prev.feature !== row.feature;
    let groupSpan = 0;
    if (isGroupStart) {
      for (let j = i; j < rows.length && rows[j].group === row.group; j += 1) {
        groupSpan += 1;
      }
    }
    let featureSpan = 0;
    if (isFeatureStart) {
      for (
        let j = i;
        j < rows.length && rows[j].group === row.group && rows[j].feature === row.feature;
        j += 1
      ) {
        featureSpan += 1;
      }
    }
    // Silence the unused-var lint while keeping the intent readable.
    void next;
    return { groupSpan, featureSpan };
  });
}

/* ------------------------------------------------------------------------- */
/* Shared edge-computing box (all tiers run on the same hardware)             */
/* ------------------------------------------------------------------------- */

export interface HardwareSpec {
  /** i18n key under `pricing.hardware.spec.<id>.label` / `.value` */
  id: string;
}

export const HARDWARE_SPECS: HardwareSpec[] = [
  { id: 'cpu' },
  { id: 'gpu' },
  { id: 'vram' },
  { id: 'tops' },
  { id: 'ram' },
  { id: 'storage' },
];

/** Deposit per box, in CNY. */
export const HARDWARE_DEPOSIT_CNY = 10000;
/** Market price of the same box (document: 2万多/台). */
export const HARDWARE_MARKET_PRICE_CNY = 20000;

/** Brand accent used by both the cards and the CTA. Mirrors index.css. */
export const BRAND = {
  primary: '#534AB7',
  secondary: '#7583b2',
};

/* ------------------------------------------------------------------------- */
/* 海外社媒矩阵加装包（Social Matrix add-on）                                  */
/* ------------------------------------------------------------------------- */

/**
 * 加装包 SKU —— **独立于套餐**的一档商品。
 *
 * 关键业务约束（定价 v2，2026-09-17 定）：
 *   - 海外社媒矩阵 **完全不进套餐**：basic → trade-flagship 五档一律 0 组。
 *     任何用户想用都必须单独购买加装包，所以它在定价页是**独立分区**，
 *     不是套餐卡里的一行功能项。
 *   - 计价单位是「品牌账号组」：1 组 = 1 个品牌 × 各平台（LinkedIn / Facebook /
 *     Instagram / YouTube / TikTok）各 1 个账号。**同一个平台的第 2 个账号才占用
 *     第 2 组** —— 这个口径刻意与聚合商（Ayrshare）按 Profile 计费的方式对齐，
 *     服务端实现与推导见 `crates/backend/nomifun-app/src/social_matrix/quota.rs`。
 *     用户问「我连了 5 个平台为什么算 3 组」时，答案就在这里。
 *   - 单组包 ¥1,299 是**保本线**（聚合商 Premium 档 ≈ ¥1,073/月，低于它每卖一单
 *     就亏一单）。**单组包绝不参与任何折扣。**
 *   - 年价逐档写死，不走折扣公式：1 组 / 3 组 = 11 个月价，6 组 / 10 组 = 10 个月价。
 *
 * `id` 必须与云端 `subscription_plans.plan_id`（迁移 048）**逐字一致**：
 * 下单时直接把 `id` 当 `plan_id` 发出去，对不上后端会报「未知的套餐或已下架」。
 *
 * ⚠️ **待办：套餐客户阶梯折扣尚未实现**（trade-biz 9.5 折 / trade-ops 9 折 /
 * trade-flagship 8.5 折，且仅 ≥3 组）。暂缓的原因：折扣必须由**服务端**裁定 ——
 * 只在前端打折会出现「页面显示折后价、扫码却是原价」这种严重的信任问题，
 * 而当前没有任何「按用户返回有效价」的接口。补齐路径：服务端加
 * `GET /api/store/social/quote`（返回该用户的组数额度、到期日与各档有效价），
 * 页面改读它。**不要把折扣规则复制到前端**：两处各算一次，早晚算出两个价。
 */
export type SocialAddonSkuId = 'social-1' | 'social-3' | 'social-6' | 'social-10';

export interface SocialAddonSku {
  /** 云端 `subscription_plans.plan_id`，下单时原样使用。 */
  id: SocialAddonSkuId;
  /** 可连接的品牌账号组数。 */
  groups: number;
  /** 月价（CNY，列表价）。 */
  priceMonthly: number;
  /** 年价（CNY，逐档写死 —— 见上方说明）。 */
  priceYearly: number;
  /** 主推档位（3 组）：卡片上加「推荐」标记。 */
  featured: boolean;
}

export const SOCIAL_ADDON_SKUS: SocialAddonSku[] = [
  { id: 'social-1', groups: 1, priceMonthly: 1299, priceYearly: 14289, featured: false },
  { id: 'social-3', groups: 3, priceMonthly: 2999, priceYearly: 32989, featured: true },
  { id: 'social-6', groups: 6, priceMonthly: 4999, priceYearly: 49990, featured: false },
  { id: 'social-10', groups: 10, priceMonthly: 6999, priceYearly: 69990, featured: false },
];

/** 加装包年付折算成月均（用于与月付对比展示）。 */
export function addonYearlyPerMonth(sku: SocialAddonSku): number {
  return Math.round(sku.priceYearly / 12);
}

/** 加装包年付相比按月付满一年省下的金额。 */
export function addonYearlySaving(sku: SocialAddonSku): number {
  return sku.priceMonthly * 12 - sku.priceYearly;
}

// ────────────────────────────────────────────────────────────────────
// 积分加油包（v5.0.69 Bug4）
//
// 1 积分 = 1 Token；1 元 = 10000 积分。4 个档位与云端迁移 049 的
// `subscription_plans.plan_id = credit-100 / 500 / 2000 / 10000` 一一对应。
//
// 加油包不进任何套餐：用户单独购买，金额累加，履约只增 `users.credits`，
// 不污染 `users.plan`。月度档 = 100万积分（= 100万 Token），年度档 = 1 亿积分。
// ────────────────────────────────────────────────────────────────────
export type CreditPackageId = 'credit-100' | 'credit-500' | 'credit-2000' | 'credit-10000';

export interface CreditPackage {
  /** 云端 `subscription_plans.plan_id`，下单时原样使用。 */
  id: CreditPackageId;
  /** 售价 CNY。 */
  priceYuan: number;
  /** 发放积分数（= Token 数，1:1）。 */
  credits: number;
  /** 主推档位（500 元）：卡片上加「推荐」标记。 */
  featured: boolean;
  /** 单价：1 元买多少积分（用于展示 "1 元 = 10000 积分"）。 */
  creditsPerYuan: number;
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  { id: 'credit-100',  priceYuan: 100,  credits: 1000000,   creditsPerYuan: 10000, featured: false },
  { id: 'credit-500',  priceYuan: 500,  credits: 5000000,   creditsPerYuan: 10000, featured: true  },
  { id: 'credit-2000', priceYuan: 2000, credits: 20000000,  creditsPerYuan: 10000, featured: false },
  { id: 'credit-10000', priceYuan: 10000, credits: 100000000, creditsPerYuan: 10000, featured: false },
];
