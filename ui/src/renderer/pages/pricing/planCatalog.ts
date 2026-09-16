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
