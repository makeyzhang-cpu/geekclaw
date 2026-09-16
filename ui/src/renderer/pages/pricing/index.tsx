/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * 套餐与定价 —— 依据《GeekClawAI办公盒子各版本服务表》实现。
 *
 * 页面结构（自上而下）：
 *   1. 端侧算力盒子（所有档位共用的硬件前提 + 押金政策）
 *   2. 五档价格卡（月付 / 年付切换，年价取文档原值，不按折扣公式推算）
 *   3. 功能对比矩阵（保留文档的 √ / 开发中 / — 三态与三级合并单元格）
 *   4. 模型按量计费表 + 常见问题
 *
 * 定价真源是 `planCatalog.ts`（前端静态目录，与文档逐项对齐）。云端
 * `GET /api/store/plans` 只用来把档位解析成下单所需的 `plan_id`——**不再**
 * 用云端返回的数据替换档位或价格，否则后台残留的旧档位会把页面顶掉。
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
import {
  BRAND,
  HARDWARE_DEPOSIT_CNY,
  PLAN_FEATURE_ROWS,
  PLAN_TIERS,
  computeMatrixSpans,
  findTier,
  yearlyPerMonth,
  yearlySaving,
  type FeatureState,
  type PlanId,
} from './planCatalog';
import packageInfo from '../../../../package.json';
import './index.css';

/** A plan row as returned by the cloud storefront (`GET /api/store/plans`). */
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

type BillingCycle = 'monthly' | 'yearly';
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

/** 三态徽标：√ / 开发中 / — */
const FeatureMark: React.FC<{ state: FeatureState }> = ({ state }) => {
  const { t } = useTranslation();
  if (state === 'dev') {
    return <span className='pricing-matrix-dev'>{t('pricing.matrix.state.dev')}</span>;
  }
  if (state === true) {
    return (
      <span className='pricing-matrix-yes' aria-label='included'>
        ✓
      </span>
    );
  }
  return (
    <span className='pricing-matrix-no' aria-label='not included'>
      {t('pricing.matrix.state.no')}
    </span>
  );
};

const PricingPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [balance, setBalance] = useState<BillingBalance | null>(null);
  const [prices, setPrices] = useState<ModelPriceInfo[]>([]);
  const [storePlans, setStorePlans] = useState<StorePlan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>('yearly');
  const cloud = useCloudAuth();

  // QR checkout modal state
  const [qrOrder, setQrOrder] = useState<QrOrder | null>(null);
  const [qrChannel, setQrChannel] = useState<QrChannel>('wechat');
  const [qrStatus, setQrStatus] = useState<'pending' | 'paid' | 'failed' | null>(null);
  const [qrStatusText, setQrStatusText] = useState<string>('等待扫码支付…');
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
      const billingMePath = cloud.state.authenticated ? '/api/store/me' : '/api/billing/me';
      try {
        const [me, pricingRes] = await Promise.all([
          httpRequest<BillingBalance>('GET', billingMePath),
          httpRequest<ModelPriceListResponse>('GET', '/api/billing/pricing'),
        ]);
        setBalance(me);
        setPrices(pricingRes.prices ?? []);
      } catch (e) {
        console.error('[pricing] load failed', e);
        setError(t('pricing.errors.loadFailed'));
        setModelsError(t('pricing.errors.modelsFailed'));
      }
      // 云端档位：只作为「下单用的 plan_id」来源，不参与展示。
      try {
        const store = await httpRequest<StorePlansResponse>('GET', '/api/store/plans');
        if (store && store.success && Array.isArray(store.plans) && store.plans.length > 0) {
          setStorePlans(store.plans);
        } else {
          setStorePlans(null);
        }
      } catch (e) {
        console.warn('[pricing] store plans unavailable', e);
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

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  /**
   * 云端档位 → 下单 plan_id 的映射表。
   *
   * 匹配口径：`backend_plan` 优先，其次 `plan_id`。两边都对不上时该档位没有
   * 云端配置，下单会退回使用档位自身 id（后端会给出明确报错，比静默失败好）。
   */
  const cloudPlanIdByTier = useMemo(() => {
    const map = new Map<PlanId, string>();
    if (!storePlans) return map;
    for (const sp of storePlans) {
      const key = (sp.backend_plan || sp.plan_id || '').trim();
      const tier = findTier(key);
      if (tier && !map.has(tier.id)) {
        map.set(tier.id, sp.plan_id);
      }
    }
    if (storePlans) {
      console.log(
        '[pricing] cloud plan mapping=%o (store plans=%o)',
        Object.fromEntries(map),
        storePlans.map((p) => `${p.plan_id}/${p.backend_plan}`)
      );
    }
    return map;
  }, [storePlans]);

  const matrixSpans = useMemo(() => computeMatrixSpans(PLAN_FEATURE_ROWS), []);

  /** `balance.plan` 存的是 `backend_plan`；用它判断哪张卡是「当前档位」。 */
  const currentPlan = balance?.plan || null;

  useEffect(() => {
    if (PLAN_TIERS.length > 0) {
      console.log('[pricing] currentPlan=%s tiers=%o', currentPlan, PLAN_TIERS.map((x) => x.id));
    }
  }, [currentPlan]);

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
    if (qrOrder && qrStatus !== 'paid') {
      const base = cloud.state.authenticated ? '/api/store' : '/api/billing';
      httpRequest('POST', `${base}/order/${encodeURIComponent(qrOrder.reqsn)}/cancel`).catch(() => {});
    }
  }, [qrOrder, qrStatus, stopPolling, cloud.state.authenticated]);

  const queryOrderOnce = useCallback(
    async (reqsn: string): Promise<boolean> => {
      try {
        const base = cloud.state.authenticated ? '/api/store' : '/api/billing';
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
          void load({ silent: true });
          Message.success('支付成功，套餐已开通');
          return true;
        }
        if (status === 'failed' || status === 'cancelled') {
          // 不把瞬时 failed/cancelled 当终态：Allinpay 可能先回 3088/3999，
          // 异步 notify 落定后才转 paid，继续轮询到全局超时。
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
      pollStartRef.current = Date.now();
      pollTimerRef.current = setTimeout(() => {
        void pollOrderStatus(qrOrder.reqsn);
      }, POLL_INTERVAL_MS);
    }
  }, [qrOrder, queryOrderOnce, pollOrderStatus, stopPolling]);

  const handleSubscribe = useCallback(
    async (tierId: PlanId) => {
      if (!cloud.state.authenticated) {
        await cloud.login();
        return;
      }
      // 云端配了对应档位就用云端的 plan_id，否则退回档位 id 让后端明确报错。
      const planId = cloudPlanIdByTier.get(tierId) ?? tierId;
      setSubscribingPlanId(tierId);
      setQrStatus('pending');
      setQrStatusText('正在创建订单…');
      try {
        const res = await httpRequest<SubscribeResponse>('POST', '/api/store/subscribe', {
          plan_id: planId,
          period: cycle,
        } as SubscribeRequest);
        if (!res || !res.reqsn) {
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
    [cloud.state.authenticated, cloud.login, pollOrderStatus, cycle, cloudPlanIdByTier]
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
                {cloud.state.user?.name ||
                  cloud.state.user?.username ||
                  cloud.state.user?.email ||
                  '云端账号'}
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

        {/* ---- 1. 端侧算力盒子 ---- */}
        <section className='pricing-hardware'>
          <div className='pricing-hardware-head'>
            <div className='pricing-hardware-intro'>
              <h2 className='pricing-hardware-title'>{t('pricing.hardware.title')}</h2>
              <p className='pricing-hardware-subtitle'>{t('pricing.hardware.subtitle')}</p>
            </div>
            <p className='pricing-hardware-market'>{t('pricing.hardware.marketNote')}</p>
          </div>

          <div className='pricing-hardware-specs'>
            {[
              'cpu',
              'gpu',
              'vram',
              'tops',
              'ram',
              'storage',
            ].map((specId) => (
              <div key={specId} className='pricing-hardware-spec'>
                <span className='pricing-hardware-spec-label'>
                  {t(`pricing.hardware.spec.${specId}.label`)}
                </span>
                <span className='pricing-hardware-spec-value'>
                  {t(`pricing.hardware.spec.${specId}.value`)}
                </span>
              </div>
            ))}
          </div>

          <div className='pricing-hardware-deposit'>
            <div className='pricing-hardware-deposit-title'>
              {t('pricing.hardware.deposit.title', {
                amount: HARDWARE_DEPOSIT_CNY.toLocaleString('zh-CN'),
              })}
            </div>
            <ul className='pricing-hardware-deposit-list'>
              <li>{t('pricing.hardware.deposit.line1')}</li>
              <li>{t('pricing.hardware.deposit.line2')}</li>
            </ul>
          </div>
        </section>

        {/* ---- 2. 计费周期切换 ---- */}
        <div className='pricing-cycle'>
          <div className='pricing-segmented' role='group' aria-label='billing cycle'>
            <button
              type='button'
              className={`pricing-seg-btn${cycle === 'monthly' ? ' pricing-seg-btn-active' : ''}`}
              aria-pressed={cycle === 'monthly'}
              onClick={() => setCycle('monthly')}
            >
              {t('pricing.monthly')}
            </button>
            <button
              type='button'
              className={`pricing-seg-btn${cycle === 'yearly' ? ' pricing-seg-btn-active' : ''}`}
              aria-pressed={cycle === 'yearly'}
              onClick={() => setCycle('yearly')}
            >
              {t('pricing.yearly')}
            </button>
          </div>
        </div>

        {/* ---- 3. 五档价格卡 ---- */}
        <section className='pricing-cards'>
          {PLAN_TIERS.map((tier) => {
            const isCurrent = !!currentPlan && currentPlan === tier.id;
            const isSubscribingThis = subscribingPlanId === tier.id;
            const isAnySubscribing = subscribingPlanId !== null;
            const showYearly = cycle === 'yearly';
            const price = showYearly ? tier.priceYearly : tier.priceMonthly;
            const periodSuffix = showYearly ? t('pricing.perYear') : t('pricing.perMonth');
            const saving = yearlySaving(tier);
            const perMonthEq = yearlyPerMonth(tier);

            let ctaLabel: string;
            let ctaDisabled = false;
            let onCta: () => void;
            if (isCurrent) {
              ctaLabel = t('pricing.currentPlan');
              ctaDisabled = true;
              onCta = () => {};
            } else {
              ctaLabel = t('pricing.cta.subscribe');
              onCta = () => void handleSubscribe(tier.id);
            }

            return (
              <div
                key={tier.id}
                className={`pricing-card${tier.allIncluded ? ' pricing-card-featured' : ''}`}
                style={tier.allIncluded ? { borderColor: BRAND.primary } : undefined}
              >
                {tier.allIncluded && (
                  <span className='pricing-recommended'>{t('pricing.badge.allIncluded')}</span>
                )}
                <div className='pricing-tier-name'>{t(`pricing.plan.${tier.id}.name`)}</div>
                <p className='pricing-tier-tagline'>{t(`pricing.plan.${tier.id}.tagline`)}</p>
                <div className='pricing-price-row'>
                  <span className='pricing-currency'>¥</span>
                  <span className='pricing-price'>{price.toLocaleString('zh-CN')}</span>
                  <span className='pricing-period'>{periodSuffix}</span>
                </div>
                {showYearly ? (
                  <div className='pricing-yearly-note'>
                    {t('pricing.yearlyPerMonthEq', { price: perMonthEq.toLocaleString('zh-CN') })}
                    <span className='pricing-yearly-save'>
                      {t('pricing.yearlySave', { amount: saving.toLocaleString('zh-CN') })}
                    </span>
                  </div>
                ) : (
                  <div className='pricing-yearly-note pricing-yearly-note-muted'>
                    {t('pricing.perYear')} ¥{tier.priceYearly.toLocaleString('zh-CN')} ·{' '}
                    {t('pricing.yearlySave', { amount: saving.toLocaleString('zh-CN') })}
                  </div>
                )}
                <button
                  type='button'
                  className={`pricing-cta${tier.allIncluded ? ' pricing-cta-primary' : ''}`}
                  disabled={ctaDisabled || isAnySubscribing}
                  onClick={onCta}
                >
                  {isSubscribingThis ? '处理中…' : ctaLabel}
                </button>
              </div>
            );
          })}
        </section>

        {/* ---- 4. 功能对比矩阵 ---- */}
        <section className='pricing-matrix'>
          <h2 className='pricing-section-title'>{t('pricing.matrix.title')}</h2>
          <div className='pricing-matrix-table-wrap'>
            <table className='pricing-matrix-table'>
              <thead>
                <tr>
                  <th className='pricing-matrix-th-group'>{t('pricing.matrix.col.group')}</th>
                  <th className='pricing-matrix-th-feature'>{t('pricing.matrix.col.feature')}</th>
                  <th className='pricing-matrix-th-detail'>{t('pricing.matrix.col.detail')}</th>
                  {PLAN_TIERS.map((tier) => (
                    <th key={tier.id} className='pricing-matrix-th-plan'>
                      <span className='pricing-matrix-plan-name'>
                        {t(`pricing.plan.${tier.id}.short`)}
                      </span>
                      <span className='pricing-matrix-plan-price'>
                        {cycle === 'yearly'
                          ? `¥${tier.priceYearly.toLocaleString('zh-CN')}${t('pricing.perYear')}`
                          : `¥${tier.priceMonthly.toLocaleString('zh-CN')}${t('pricing.perMonth')}`}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PLAN_FEATURE_ROWS.map((row, i) => {
                  const span = matrixSpans[i];
                  return (
                    <tr key={row.id}>
                      {span.groupSpan > 0 && (
                        <td className='pricing-matrix-group' rowSpan={span.groupSpan}>
                          {t(`pricing.matrix.group.${row.group}`)}
                        </td>
                      )}
                      {span.featureSpan > 0 && (
                        <td className='pricing-matrix-feature' rowSpan={span.featureSpan}>
                          {t(`pricing.matrix.feature.${row.feature}`)}
                        </td>
                      )}
                      <td className='pricing-matrix-detail'>
                        <ul className='pricing-matrix-detail-list'>
                          {Array.from({ length: row.detailCount }, (_, n) => (
                            <li
                              key={n}
                              className={
                                row.headline && n === 0 ? 'pricing-matrix-detail-head' : undefined
                              }
                            >
                              {t(`pricing.matrix.${row.id}.d${n + 1}`)}
                            </li>
                          ))}
                        </ul>
                      </td>
                      {PLAN_TIERS.map((tier) => (
                        <td key={tier.id} className='pricing-matrix-cell'>
                          <FeatureMark state={row.values[tier.id]} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className='pricing-matrix-note'>{t('pricing.matrix.note')}</p>
        </section>

        {/* ---- 5. 模型按量计费 ---- */}
        <section className='pricing-models'>
          <h2 className='pricing-section-title'>{t('pricing.models.title')}</h2>
          {modelsError && <div className='pricing-error'>{modelsError}</div>}
          {!modelsError && prices.length === 0 && (
            <div className='pricing-empty'>{t('pricing.models.empty')}</div>
          )}
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
            {currentQrString && <div className='pricing-qr-string'>{currentQrString}</div>}
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
              <button type='button' className='pricing-qr-refresh' onClick={refreshPaymentStatus}>
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
