/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Collapse, Message } from '@arco-design/web-react';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { httpRequest, isBackendHttpError } from '@/common/adapter/httpBridge';
import { useCloudAuth } from '@renderer/hooks/context/CloudAuthContext';
import type {
  BillingBalance,
  ModelPriceInfo,
  ModelPriceListResponse,
  SubscribeResponse,
  OrderStatusResponse,
  SubscribeRequest,
} from '@/common/types/billing/billingTypes';
import { BRAND, PLAN_TIERS, type PlanId } from './planCatalog';
import packageInfo from '../../../../package.json';
import './index.css';

/**
 * A plan as returned by the central cloud backend via the desktop proxy
 * `GET /api/store/plans` (which relays https://www.geekclaw.ai/admin data).
 */
interface StorePlan {
  plan_id: string;
  name: string;
  backend_plan: string;
  price_fen: number;
  credits: number;
  description: string;
  sort_order: number;
}

interface StorePlansResponse {
  success: boolean;
  plans: StorePlan[];
}

/**
 * Unified card model consumed by the render loop. It is produced either from
 * the cloud-synced `StorePlan[]` (fromCloud = true) or from the built-in
 * `PLAN_TIERS` fallback (fromCloud = false) when the cloud is unreachable, so
 * the page is never blank.
 */
interface DisplayPlan {
  id: string;
  tierKey: PlanId;
  /** Cloud display name; empty => resolve via i18n `pricing.tier.<tierKey>`. */
  name: string;
  priceMonthly: number;
  isFree: boolean;
  recommended: boolean;
  credits: number;
  quotaKey: PlanId;
  featureKeys: string[];
  /** When true, `featureKeys` are literal strings (not i18n keys). */
  featureIsRaw: boolean;
  description?: string;
  fromCloud: boolean;
  /**
   * The backend plan identifier (`subscription_plans.backend_plan`).
   * Used to decide which card is the user's current plan, because
   * `BillingBalance.plan` is stored as `backend_plan`, not as the frontend
   * tier key or cloud `plan_id`.
   */
  backendPlan: string;
}

/** Map cloud plans into DisplayPlan[]. Falls back to the built-in catalog. */
function toDisplayPlans(store: StorePlan[] | null): DisplayPlan[] {
  const knownTierIds = new Set<PlanId>(['free', 'pro', 'team']);
  if (!store || store.length === 0) {
    return PLAN_TIERS.map((tier) => ({
      id: tier.id,
      tierKey: tier.tierKey,
      name: '',
      priceMonthly: tier.priceMonthly,
      isFree: tier.priceMonthly === 0,
      recommended: tier.recommended,
      credits: -1,
      quotaKey: tier.quotaKey,
      featureKeys: tier.featureKeys,
      featureIsRaw: false,
      description: undefined,
      fromCloud: false,
      backendPlan: tier.id,
    }));
  }
  return store
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((sp): DisplayPlan => {
      const base = PLAN_TIERS.find((t) => t.id === sp.backend_plan);
      const isFree = sp.price_fen === 0;
      // Preserve the real backend plan for current-plan matching. Only fall
      // back to the built-in tier key for i18n/feature lookup; unknown
      // backend_plan values stay distinct so they don't all collapse to 'pro'.
      const tierKey = (base?.tierKey ??
        (knownTierIds.has(sp.backend_plan as PlanId)
          ? (sp.backend_plan as PlanId)
          : 'pro')) as PlanId;
      return {
        id: sp.plan_id,
        tierKey,
        name: sp.name,
        priceMonthly: sp.price_fen / 100,
        isFree,
        recommended: base?.recommended ?? false,
        credits: sp.credits,
        quotaKey: (base?.quotaKey ?? 'pro') as PlanId,
        featureKeys: base ? base.featureKeys : [],
        featureIsRaw: !base,
        description: sp.description,
        fromCloud: true,
        backendPlan: sp.backend_plan,
      };
    });
}

type QrChannel = 'wechat' | 'alipay';

interface QrOrder {
  reqsn: string;
  amountFen: number;
  plan: string;
  period: string;
  payinfo: Record<string, string>;
}

const CHANNEL_LABELS: Record<QrChannel, string> = {
  wechat: '微信支付',
  alipay: '支付宝',
};

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes, matching frontend polling policy

const PricingPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [balance, setBalance] = useState<BillingBalance | null>(null);
  const [prices, setPrices] = useState<ModelPriceInfo[]>([]);
  const [storePlans, setStorePlans] = useState<StorePlan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const cloud = useCloudAuth();

  // QR checkout modal state
  const [qrOrder, setQrOrder] = useState<QrOrder | null>(null);
  const [qrChannel, setQrChannel] = useState<QrChannel>('wechat');
  const [qrStatus, setQrStatus] = useState<'pending' | 'paid' | 'failed' | null>(null);
  const [qrStatusText, setQrStatusText] = useState<string>('等待扫码支付…');
  // Track which plan is currently being subscribed to, so only that card
  // shows a loading state instead of all upgrade buttons flashing together.
  const [subscribingPlanId, setSubscribingPlanId] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollStartRef = useRef<number>(0);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) {
        setLoading(true);
      }
      setError(null);
      setModelsError(null);
      // Billing info: when signed into a cloud account, read balance from the
      // cloud backend; otherwise fall back to the local desktop ledger.
      const billingMePath = cloud.state.authenticated ? '/api/store/me' : '/api/billing/me';
      try {
        const [me, pricingRes] = await Promise.all([
          httpRequest<BillingBalance>('GET', billingMePath),
          httpRequest<ModelPriceListResponse>('GET', '/api/billing/pricing'),
        ]);
        setBalance(me);
        setPrices(pricingRes.prices ?? []);
      } catch (e) {
        // Distinguish the two failures so the cards still render even if one
        // endpoint is unavailable.
        console.error('[pricing] load failed', e);
        setError(t('pricing.errors.loadFailed'));
        setModelsError(t('pricing.errors.modelsFailed'));
      }
      // Cloud-synced store plans (admin console). Independent of the above; on
      // any failure we fall back to the built-in catalog so the page is never
      // blank.
      try {
        const store = await httpRequest<StorePlansResponse>('GET', '/api/store/plans');
        if (store && store.success && Array.isArray(store.plans) && store.plans.length > 0) {
          setStorePlans(store.plans);
        } else {
          setStorePlans(null);
        }
      } catch (e) {
        console.warn('[pricing] store plans unavailable, using fallback catalog', e);
        setStorePlans(null);
      } finally {
        setLoading(false);
      }
    },
    [t, cloud.state.authenticated]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Clean up polling on unmount.
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  const displayPlans = useMemo(() => toDisplayPlans(storePlans), [storePlans]);
  const syncedFromCloud = storePlans !== null;

  // `balance.plan` is the active `backend_plan` string from the cloud/local
  // ledger. Use it as-is; do NOT fall back to 'free' when missing, because an
  // empty/missing plan must not accidentally mark every card as current.
  const currentPlan = balance?.plan || null;

  // Diagnostic logging so we can verify which plan the backend reports and
  // which cards are being rendered, without needing a screenshot of devtools.
  useEffect(() => {
    if (displayPlans.length > 0) {
      console.log('[pricing] currentPlan=%s, plans=%o', currentPlan, displayPlans.map((d) => ({
        id: d.id,
        backendPlan: d.backendPlan,
        tierKey: d.tierKey,
      })));
    }
  }, [currentPlan, displayPlans]);

  const faqItems = useMemo(
    () =>
      [1, 2, 3, 4].map((n) => ({
        key: String(n),
        header: t(`pricing.faq.q${n}`),
        content: t(`pricing.faq.a${n}`),
      })),
    [t]
  );

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const closeQr = useCallback(() => {
    stopPolling();
    setQrOrder(null);
    setQrStatus(null);
    setQrStatusText('');
    // Optionally cancel an unpaid order so it doesn't sit in `created`.
    // Cloud-authenticated purchases live in the cloud backend; otherwise local.
    if (qrOrder && qrStatus !== 'paid') {
      const base = cloud.state.authenticated ? '/api/store' : '/api/billing';
      httpRequest('POST', `${base}/order/${encodeURIComponent(qrOrder.reqsn)}/cancel`).catch(() => {});
    }
  }, [qrOrder, qrStatus, stopPolling, cloud.state.authenticated]);

  const queryOrderOnce = useCallback(
    async (reqsn: string): Promise<boolean> => {
      try {
        const base = cloud.state.authenticated ? '/api/store' : '/api/billing';
        // `httpRequest` unwraps the envelope; `res` is the `OrderStatusResponse`.
        const res = await httpRequest<OrderStatusResponse>(
          'GET',
          `${base}/order/${encodeURIComponent(reqsn)}`
        );
        if (!res || !res.reqsn) return false;
        const status = res.status;
        if (status === 'paid') {
          setQrStatus('paid');
          setQrStatusText('支付成功，套餐已开通！');
          stopPolling();
          void load({ silent: true }); // refresh balance / plan without flashing a loading overlay
          Message.success('支付成功，套餐已开通');
          return true;
        }
        if (status === 'failed' || status === 'cancelled') {
          // Do NOT treat a transient failed/cancelled as final: Allinpay may
          // report 3088/3999 briefly before the async notify settles the order
          // to paid. Keep polling until the global timeout so the UI catches
          // the real paid state.
          setQrStatus('pending');
          setQrStatusText('支付结果确认中，请稍候…');
          return false;
        }
        setQrStatus('pending');
        setQrStatusText('等待扫码支付…');
        return false;
      } catch (e) {
        console.error('[pricing] order poll failed', e);
        return false;
      }
    },
    [load, stopPolling, cloud.state.authenticated]
  );

  const pollOrderStatus = useCallback(
    async (reqsn: string) => {
      const done = await queryOrderOnce(reqsn);
      if (done) return;
      if (Date.now() - pollStartRef.current < POLL_TIMEOUT_MS) {
        pollTimerRef.current = setTimeout(() => {
          void pollOrderStatus(reqsn);
        }, POLL_INTERVAL_MS);
      } else {
        setQrStatus('failed');
        setQrStatusText('等待支付超时，请关闭后重试');
        stopPolling();
      }
    },
    [queryOrderOnce, stopPolling]
  );

  const refreshPaymentStatus = useCallback(async () => {
    if (!qrOrder) return;
    setQrStatus('pending');
    setQrStatusText('正在确认支付结果…');
    stopPolling();
    const done = await queryOrderOnce(qrOrder.reqsn);
    if (!done) {
      // Restart the polling window from now so the user gets a fresh timeout
      // after explicitly asking for a refresh.
      pollStartRef.current = Date.now();
      pollTimerRef.current = setTimeout(() => {
        void pollOrderStatus(qrOrder.reqsn);
      }, POLL_INTERVAL_MS);
    }
  }, [qrOrder, queryOrderOnce, pollOrderStatus, stopPolling]);

  const handleSubscribe = useCallback(
    async (planId: string) => {
      if (!cloud.state.authenticated) {
        await cloud.login();
        return;
      }
      setSubscribingPlanId(planId);
      setQrStatus('pending');
      setQrStatusText('正在创建订单…');
      try {
        // Cloud-authenticated purchases are handled by the cloud backend,
        // which owns the plan catalog and payment gateway configuration.
        // `httpRequest` already strips the `{ success, data }` envelope and
        // returns the inner `SubscribeResponse`, so `res` is the order payload
        // directly — there is no `.success`/`.data` wrapper to unwrap here.
        const res = await httpRequest<SubscribeResponse>('POST', '/api/store/subscribe', {
          plan_id: planId,
          period: 'monthly',
        } as SubscribeRequest);
        if (!res || !res.reqsn) {
          // `httpRequest` normally strips the `{ success, data }` envelope and
          // returns the inner payload. The only way we land here is either a
          // genuine backend failure or an error envelope returned inside a 200
          // (no `data` wrapper) — in both cases surface the real message
          // instead of swallowing it as a generic "创建订单失败".
          const backendMsg =
            (typeof res?.error === 'string' && res.error) ||
            (typeof res?.message === 'string' && res.message) ||
            null;
          throw new Error(backendMsg || '创建订单失败');
        }
        const { reqsn, amount_fen, plan, period, payinfo } = res;
        setQrOrder({ reqsn, amountFen: amount_fen, plan, period, payinfo });
        setQrChannel(payinfo.wechat ? 'wechat' : 'alipay');
        pollStartRef.current = Date.now();
        void pollOrderStatus(reqsn);
      } catch (e) {
        console.error('[pricing] subscribe failed', e);
        const errorMessage = isBackendHttpError(e)
          ? e.backendMessage || e.message
          : e instanceof Error
            ? e.message
            : '创建订单失败';
        setQrStatus('failed');
        setQrStatusText(errorMessage);
        Message.error(errorMessage);
      } finally {
        setSubscribingPlanId(null);
      }
    },
    [cloud.state.authenticated, cloud.login, pollOrderStatus]
  );

  const currentQrString = qrOrder ? qrOrder.payinfo[qrChannel] || '' : '';

  return (
    <div className='pricing-page'>
      <header className='pricing-header'>
        <div className='pricing-header-text'>
          <h1 className='pricing-title'>{t('pricing.title')}</h1>
          <p className='pricing-subtitle'>
            {t('pricing.subtitle')}
            <span className='pricing-version'>v{packageInfo.version}</span>
          </p>
        </div>
        <div className='pricing-cloud-bar'>
          {cloud.state.authenticated ? (
            <div className='pricing-cloud-user'>
              <span className='pricing-cloud-name'>
                {cloud.state.user?.name || cloud.state.user?.username || cloud.state.user?.email || '云端账号'}
              </span>
              <button type='button' className='pricing-text-btn' onClick={() => void cloud.logout()}>
                退出云端
              </button>
            </div>
          ) : (
            <button
              type='button'
              className='pricing-cloud-login-btn'
              disabled={cloud.busy}
              onClick={() => void cloud.login()}
            >
              {cloud.busy ? '请在浏览器中登录…' : '登录云端账号'}
            </button>
          )}
        </div>
      </header>

      {error && <div className='pricing-error'>{error}</div>}

      <main className='pricing-body'>
        {loading && (
          <div className='pricing-loading-overlay'>
            <div className='pricing-loading-spinner' />
            <span>{t('billing.loading')}</span>
          </div>
        )}

        <section className='pricing-cards'>
          {displayPlans.map((dp) => {
            // `BillingBalance.plan` stores the active subscription's
            // `backend_plan`, so match against that first; also accept the cloud
            // `plan_id` as a fallback for older/local ledgers.
            // Only mark a card as current when the ledger reports a concrete
            // plan and it matches either the cloud plan_id or backend_plan.
            const isCurrent =
              !!currentPlan && (currentPlan === dp.backendPlan || currentPlan === dp.id);
            const price = dp.priceMonthly;
            const priceSuffix = dp.isFree ? t('pricing.forever') : t('pricing.perMonth');
            const quotaText = dp.fromCloud
              ? t('pricing.creditsQuota', { count: dp.credits })
              : t(`pricing.quota.${dp.quotaKey}`);

            const isSubscribingThis = subscribingPlanId === dp.id;
            const isAnySubscribing = subscribingPlanId !== null;
            let ctaLabel: string;
            let ctaDisabled = false;
            let onCta: () => void;
            if (isCurrent) {
              ctaLabel = t('pricing.currentPlan');
              ctaDisabled = true;
              onCta = () => {};
            } else if (dp.isFree) {
              ctaLabel = t('pricing.getStarted');
              onCta = () => navigate('/guid');
            } else {
              ctaLabel = t('pricing.upgrade');
              onCta = () => void handleSubscribe(dp.id);
            }

            return (
              <div
                key={dp.id}
                className={`pricing-card${dp.recommended ? ' pricing-card-featured' : ''}`}
                style={dp.recommended ? { borderColor: BRAND.primary } : undefined}
              >
                {dp.recommended && <span className='pricing-recommended'>{t('pricing.recommended')}</span>}
                <div className='pricing-tier-name'>{dp.name || t(`pricing.tier.${dp.tierKey}`)}</div>
                <div className='pricing-price-row'>
                  <span className='pricing-currency'>¥</span>
                  <span className='pricing-price'>{price}</span>
                  <span className='pricing-period'>{priceSuffix}</span>
                </div>
                <div className='pricing-quota'>{quotaText}</div>
                {dp.featureKeys.length > 0 && (
                  <ul className='pricing-features'>
                    {dp.featureKeys.map((key, i) => (
                      <li key={i} className='pricing-feature'>
                        <span className='pricing-check' aria-hidden>
                          ✓
                        </span>
                        <span>{dp.featureIsRaw ? key : t(`pricing.feature.${key}`)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {dp.fromCloud && dp.description && <div className='pricing-desc'>{dp.description}</div>}
                <button
                  type='button'
                  className={`pricing-cta${dp.recommended ? ' pricing-cta-primary' : ''}`}
                  disabled={ctaDisabled || isAnySubscribing}
                  onClick={onCta}
                >
                  {isSubscribingThis ? '处理中…' : ctaLabel}
                </button>
              </div>
            );
          })}
        </section>

        {syncedFromCloud && <p className='pricing-sync-note'>{t('pricing.syncedFromCloud')}</p>}

        <section className='pricing-models'>
          <h2 className='pricing-section-title'>{t('pricing.models.title')}</h2>
          {modelsError && <div className='pricing-error'>{modelsError}</div>}
          {!modelsError && prices.length === 0 && <div className='pricing-empty'>{t('pricing.models.empty')}</div>}
          {!modelsError && prices.length > 0 && (
            <div className='pricing-models-table-wrap'>
              <table className='pricing-models-table'>
                <thead>
                  <tr>
                    <th>{t('billing.admin.provider')}</th>
                    <th>{t('billing.admin.model')}</th>
                    <th>{t('billing.admin.task')}</th>
                    <th>
                      {t('billing.admin.inputPer1k')}
                      <span className='pricing-unit'>{t('pricing.models.per1k')}</span>
                    </th>
                    <th>
                      {t('billing.admin.outputPer1k')}
                      <span className='pricing-unit'>{t('pricing.models.per1k')}</span>
                    </th>
                    <th>
                      {t('billing.admin.cacheReadPer1k')}
                      <span className='pricing-unit'>{t('pricing.models.per1k')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {prices.map((p) => (
                    <tr key={p.id}>
                      <td>{p.provider}</td>
                      <td>{p.model}</td>
                      <td>{p.task}</td>
                      <td>{p.input_credits_per_1k}</td>
                      <td>{p.output_credits_per_1k}</td>
                      <td>{p.cache_read_credits_per_1k}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className='pricing-faq'>
          <h2 className='pricing-section-title'>{t('pricing.faq.title')}</h2>
          <Collapse>
            {faqItems.map((item) => (
              <Collapse.Item key={item.key} name={item.key} header={item.header}>
                {item.content}
              </Collapse.Item>
            ))}
          </Collapse>
        </section>

        <div className='pricing-footer-link'>
          <button type='button' className='pricing-text-btn' onClick={() => navigate('/billing')}>
            {t('userMenu.points')} →
          </button>
        </div>
      </main>

      {/* QR checkout modal */}
      {qrOrder && (
        <div className='pricing-qr-overlay' onClick={closeQr}>
          <div className='pricing-qr-card' onClick={(e) => e.stopPropagation()}>
            <h2 className='pricing-qr-title'>扫码支付</h2>
            <p className='pricing-qr-subtitle'>
              订单 {qrOrder.reqsn} · ¥{(qrOrder.amountFen / 100).toFixed(2)} · {qrOrder.plan}
            </p>
            <div className='pricing-qr-tabs'>
              {(['wechat', 'alipay'] as QrChannel[]).map((ch) =>
                qrOrder.payinfo[ch] ? (
                  <button
                    key={ch}
                    type='button'
                    className={`pricing-qr-tab${qrChannel === ch ? ' pricing-qr-tab-active' : ''}`}
                    onClick={() => setQrChannel(ch)}
                  >
                    {CHANNEL_LABELS[ch]}
                  </button>
                ) : null
              )}
            </div>
            <div className='pricing-qr-box'>
              {currentQrString ? (
                <QRCodeSVG value={currentQrString} size={176} />
              ) : (
                <span style={{ color: 'var(--color-text-3)' }}>暂无该渠道二维码</span>
              )}
            </div>
            {currentQrString && (
              <div className='pricing-qr-string'>{currentQrString}</div>
            )}
            {qrStatus && (
              <div
                className={`pricing-qr-status ${
                  qrStatus === 'paid'
                    ? 'pricing-qr-status-success'
                    : qrStatus === 'failed'
                      ? 'pricing-qr-status-failed'
                      : 'pricing-qr-status-pending'
                }`}
              >
                {qrStatusText}
              </div>
            )}
            {qrStatus !== 'paid' && (
              <button
                type='button'
                className='pricing-qr-refresh'
                onClick={refreshPaymentStatus}
              >
                我已支付，刷新状态
              </button>
            )}
            <button type='button' className='pricing-qr-close' onClick={closeQr}>
              {qrStatus === 'paid' ? '完成' : '关闭'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PricingPage;
