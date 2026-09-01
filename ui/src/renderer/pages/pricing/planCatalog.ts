/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Static catalog of GeekClaw pricing tiers.
 *
 * Prices and quotas are intentionally hard-coded here (frontend-only config) so
 * marketing copy / pricing can be tuned without a backend change. The backend
 * stays the source of truth for *actual* billing (credits ledger via
 * /api/billing/*), and the pricing page reads the live model price list from
 * /api/billing/pricing for the pay-as-you-go table.
 *
 * `featureKeys` are language-neutral keys resolved through
 * `t('pricing.feature.<key>')` on the page so the catalog stays locale-agnostic.
 */

export type PlanId = 'free' | 'pro' | 'team';

export interface PlanTier {
  id: PlanId;
  /** i18n key under pricing.tier.* */
  tierKey: PlanId;
  /** Per-month list price in CNY (0 = free). */
  priceMonthly: number;
  /** Whether this tier is the highlighted / recommended one. */
  recommended: boolean;
  /** i18n key under pricing.quota.* (the headline quota line). */
  quotaKey: PlanId;
  /** Language-neutral feature keys resolved via pricing.feature.* */
  featureKeys: string[];
}

/** Annual discount applied to the monthly-equivalent price (Save 25%). */
export const YEARLY_DISCOUNT = 0.25;

export const PLAN_TIERS: PlanTier[] = [
  {
    id: 'free',
    tierKey: 'free',
    priceMonthly: 0,
    recommended: false,
    quotaKey: 'free',
    featureKeys: ['free1', 'free2', 'free3'],
  },
  {
    id: 'pro',
    tierKey: 'pro',
    priceMonthly: 99,
    recommended: true,
    quotaKey: 'pro',
    featureKeys: ['pro1', 'pro2', 'pro3', 'pro4'],
  },
  {
    id: 'team',
    tierKey: 'team',
    priceMonthly: 299,
    recommended: false,
    quotaKey: 'team',
    featureKeys: ['team1', 'team2', 'team3', 'team4'],
  },
];

/**
 * Monthly-equivalent price when billed yearly (rounded). Free stays 0.
 * The card shows this number with the "/ 月" suffix while the yearly toggle is
 * active, with the annual total surfaced as a sub-label.
 */
export function yearlyMonthlyPrice(tier: PlanTier): number {
  if (tier.priceMonthly === 0) return 0;
  return Math.round(tier.priceMonthly * (1 - YEARLY_DISCOUNT));
}

/** Total charged for a full year (monthly × 12 × (1 - discount)). */
export function yearlyTotalPrice(tier: PlanTier): number {
  if (tier.priceMonthly === 0) return 0;
  return Math.round(tier.priceMonthly * 12 * (1 - YEARLY_DISCOUNT));
}

/** Brand accent used by both the cards and the CTA. Mirrors index.css. */
export const BRAND = {
  primary: '#534AB7',
  secondary: '#7583b2',
};
