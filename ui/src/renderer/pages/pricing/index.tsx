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
} from './planCatalog';import packageInfo from '../../../../package.json';
import './index.css';

/** A plan row as returned by the cloud storefront (`GET /api/store/plans`). */
interface StorePlan {
  plan_id: string;
  name: string;
  backend_plan: string;
  price_fen: number;
  /** Per-plan yearly price in 分; `0`/absent = the cloud uses its shared multiplier. */
  price_year_fen?: number;
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

/**
 * Translate the UI's billing cycle into the value the cloud backend understands.
 *
 * The cloud (`period_multiplier` in `crates/backend/nomifun-auth/src/routes.rs`)
 * only recognises `monthly` / `quarterly` / `annual`; **anything else is silently
 * coerced to `monthly`**. Our switch says `yearly`, so it MUST be translated here —
 * sending `yearly` verbatim would create an order for a single month's price.
 */
function toBackendPeriod(cycle: BillingCycle): 'monthly' | 'annual' {
  return cycle === 'yearly' ? 'annual' : 'monthly';
}

interface QrOrder {
  reqsn: string;
  amountFen: number;
  plan: string;
  period: string;
  payinfo: Record<string, string>;
  /**
   * 订单类型。
   *
   * `plan` = 套餐订阅，扫码付款后闭环结束；
   * `hardware` = 硬件押金（端侧算力盒子），付款成功后**还要继续收集收货地址**，
   * 否则后台无从发货 —— 这是 2026-09-16 用户反馈的核心闭环缺口。
   */
  kind: 'plan' | 'hardware';
}

/** 我的押金单（`GET /api/store/hardware/deposits` 的一行）。 */
interface HardwareDepositRow {
  reqsn: string;
  deposit_fen: number;
  region: string | null;
  receiver_name: string | null;
  receiver_phone: string | null;
  detail_address: string | null;
  remark: string | null;
  /** `created`（待支付）| `paid`（已支付待填地址）| `shipped`（已发货）。 */
  status: string;
  shipped_at: number | null;
  created_at: number;
}

/** 后端硬件押金下单接口的响应（与套餐下单同构，便于复用扫码弹窗）。 */
interface HardwareDepositOrderResponse {
  reqsn: string;
  amount_fen: number;
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

  // ---- 硬件押金（端侧算力盒子）状态 ----
  /** 我的押金单（按下单时间倒序），用于回显「是否已提交收货地址」。 */
  const [deposits, setDeposits] = useState<HardwareDepositRow[]>([]);
  const [depositSubmitting, setDepositSubmitting] = useState(false);
  /** 非空时打开「填写 / 修改收货地址」弹窗。 */
  const [addressFor, setAddressFor] = useState<string | null>(null);
  const [addrName, setAddrName] = useState('');
  const [addrPhone, setAddrPhone] = useState('');
  const [addrRegion, setAddrRegion] = useState('');
  const [addrDetail, setAddrDetail] = useState('');
  const [addrRemark, setAddrRemark] = useState('');
  const [addrSubmitting, setAddrSubmitting] = useState(false);
  /**
   * 当前扫码弹窗里的订单类型。
   *
   * `queryOrderOnce` 只拿到 `reqsn`，但付款成功后的文案与后续动作（套餐=结束 /
   * 押金=继续收地址）必须区分，所以用 ref 记住类型而不是把 qrOrder 塞进依赖。
   */
  const qrOrderKindRef = useRef<'plan' | 'hardware'>('plan');

  const loadDeposits = useCallback(async () => {
    if (!cloud.state.authenticated) {
      setDeposits([]);
      return;
    }
    try {
      const res = await httpRequest<HardwareDepositRow[] | { deposits?: HardwareDepositRow[] }>(
        'GET',
        '/api/store/hardware/deposits'
      );
      const rows = Array.isArray(res) ? res : (res?.deposits ?? []);
      setDeposits(Array.isArray(rows) ? rows : []);
    } catch (e) {
      // 云端还没部署押金接口时不影响定价页其余部分，静默降级为空列表。
      console.warn('[pricing] hardware deposits unavailable', e);
      setDeposits([]);
    }
  }, [cloud.state.authenticated]);

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
    void loadDeposits();
  }, [loadDeposits]);

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

  /**
   * 功能对比表在窄窗口下会横向溢出（5 个档位列放不下）。
   * 桌面端 webview 的滚动条是自动隐藏的，用户会直接判定「少了一栏」，
   * 所以一旦真的溢出就显式给一条提示。
   */
  const matrixWrapRef = useRef<HTMLDivElement | null>(null);
  const [matrixScrollable, setMatrixScrollable] = useState(false);
  useEffect(() => {
    const el = matrixWrapRef.current;
    if (!el) return;
    const measure = () => setMatrixScrollable(el.scrollWidth > el.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
          const isDeposit = qrOrderKindRef.current === 'hardware';
          setQrStatus('paid');
          setQrStatusText(
            isDeposit
              ? t('pricing.hardware.deposit.paidTip')
              : '支付成功，套餐已开通！'
          );
          stopPolling();
          void load({ silent: true });
          void loadDeposits();
          Message.success(
            isDeposit ? t('pricing.hardware.deposit.paidTip') : '支付成功，套餐已开通'
          );
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
    [load, loadDeposits, stopPolling, cloud.state.authenticated, t]
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
      qrOrderKindRef.current = 'plan';
      setSubscribingPlanId(tierId);
      setQrStatus('pending');
      setQrStatusText('正在创建订单…');
      try {
        const res = await httpRequest<SubscribeResponse>('POST', '/api/store/subscribe', {
          plan_id: planId,
          period: toBackendPeriod(cycle),
        } as SubscribeRequest);
        if (!res || !res.reqsn) {
          const backendMsg =
            (typeof res?.error === 'string' && res.error) ||
            (typeof res?.message === 'string' && res.message) ||
            null;
          throw new Error(backendMsg || '创建订单失败');
        }
        const { reqsn, amount_fen, plan, period, payinfo } = res;
        setQrOrder({ reqsn, amountFen: amount_fen, plan, period, payinfo, kind: 'plan' });
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

  /**
   * 支付硬件押金（端侧算力盒子 ¥10,000/台）。
   *
   * 与套餐下单唯一的区别：金额由**服务端常量**决定（不接受客户端传值），并且
   * 付款成功后还差一步「提交收货地址」——没有地址后台就发不了货。
   */
  const handleDepositPay = useCallback(async () => {
    if (!cloud.state.authenticated) {
      await cloud.login();
      return;
    }
    if (depositSubmitting) return;
    qrOrderKindRef.current = 'hardware';
    setDepositSubmitting(true);
    setQrStatus('pending');
    setQrStatusText('正在创建押金订单…');
    try {
      const res = await httpRequest<HardwareDepositOrderResponse>(
        'POST',
        '/api/store/hardware/deposit'
      );
      if (!res || !res.reqsn) {
        throw new Error(t('pricing.hardware.deposit.payFailed'));
      }
      setQrOrder({
        reqsn: res.reqsn,
        amountFen: res.amount_fen,
        plan: res.plan,
        period: res.period,
        payinfo: res.payinfo ?? {},
        kind: 'hardware',
      });
      setQrChannel(res.payinfo?.wechat ? 'wechat' : 'alipay');
      pollStartRef.current = Date.now();
      void pollOrderStatus(res.reqsn);
    } catch (e) {
      console.error('[pricing] hardware deposit failed', e);
      const errorMessage = isBackendHttpError(e)
        ? e.backendMessage || e.message
        : e instanceof Error
          ? e.message
          : t('pricing.hardware.deposit.payFailed');
      setQrStatus('failed');
      setQrStatusText(errorMessage);
      Message.error(errorMessage);
    } finally {
      setDepositSubmitting(false);
    }
  }, [cloud.state.authenticated, cloud.login, depositSubmitting, pollOrderStatus, t]);

  /** 打开「填写 / 修改收货地址」弹窗，已填过的地址自动回填。 */
  const openAddressForm = useCallback(
    (reqsn: string) => {
      const existing = deposits.find((d) => d.reqsn === reqsn);
      setAddrName(existing?.receiver_name ?? '');
      setAddrPhone(existing?.receiver_phone ?? '');
      setAddrRegion(existing?.region ?? '');
      setAddrDetail(existing?.detail_address ?? '');
      setAddrRemark(existing?.remark ?? '');
      setAddressFor(reqsn);
    },
    [deposits]
  );

  /** 提交收货地址（服务端会校验「已付款」与「未发货」两道门槛）。 */
  const submitAddress = useCallback(async () => {
    if (!addressFor || addrSubmitting) return;
    const name = addrName.trim();
    const phone = addrPhone.trim();
    const detail = addrDetail.trim();
    const digits = phone.replace(/\D/g, '');
    if (!name) {
      Message.error(t('pricing.hardware.deposit.errName'));
      return;
    }
    if (digits.length < 6 || !/^[0-9+\-() ]+$/.test(phone)) {
      Message.error(t('pricing.hardware.deposit.errPhone'));
      return;
    }
    if (!detail) {
      Message.error(t('pricing.hardware.deposit.errDetail'));
      return;
    }
    setAddrSubmitting(true);
    try {
      await httpRequest(
        'POST',
        `/api/store/hardware/deposit/${encodeURIComponent(addressFor)}/address`,
        {
          receiver_name: name,
          receiver_phone: phone,
          region: addrRegion.trim(),
          detail_address: detail,
          remark: addrRemark.trim(),
        }
      );
      Message.success(t('pricing.hardware.deposit.submitted'));
      setAddressFor(null);
      void loadDeposits();
    } catch (e) {
      console.error('[pricing] submit address failed', e);
      const msg = isBackendHttpError(e)
        ? e.backendMessage || e.message
        : e instanceof Error
          ? e.message
          : t('pricing.hardware.deposit.addressFailed');
      Message.error(msg);
    } finally {
      setAddrSubmitting(false);
    }
  }, [
    addressFor,
    addrSubmitting,
    addrName,
    addrPhone,
    addrRegion,
    addrDetail,
    addrRemark,
    loadDeposits,
    t,
  ]);

  /**
   * 押金付完后从扫码弹窗进入地址表单：先关掉扫码弹窗（已付款不会触发取消），
   * 再打开地址弹窗。
   */
  const goToAddressForm = useCallback(() => {
    const reqsn = qrOrder?.reqsn;
    closeQr();
    if (reqsn) {
      openAddressForm(reqsn);
    }
  }, [qrOrder, closeQr, openAddressForm]);

  /** 最近一张押金单，用于硬件区回显「押金已支付 / 地址已提交 / 已发货」。 */
  const latestDeposit = deposits.length > 0 ? deposits[0] : null;

  /** 该押金单是否已发货 —— 已发货则地址只读（服务端同样会拒绝写入）。 */
  const addressShipped =
    !!addressFor && deposits.some((d) => d.reqsn === addressFor && d.status === 'shipped');

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
            <div className='pricing-hardware-deposit-main'>
              <div className='pricing-hardware-deposit-title'>
                {t('pricing.hardware.deposit.title', {
                  amount: HARDWARE_DEPOSIT_CNY.toLocaleString('zh-CN'),
                })}
              </div>
              <ul className='pricing-hardware-deposit-list'>
                <li>{t('pricing.hardware.deposit.line1')}</li>
                <li>{t('pricing.hardware.deposit.line2')}</li>
              </ul>
              <p className='pricing-hardware-deposit-hint'>
                {t('pricing.hardware.deposit.payHint')}
              </p>
              {latestDeposit && (
                <p className='pricing-hardware-deposit-status'>
                  <span className='pricing-hardware-deposit-status-label'>
                    {t('pricing.hardware.deposit.myOrder')}
                  </span>
                  <code>{latestDeposit.reqsn}</code>
                  <span
                    className={`pricing-hardware-deposit-pill pricing-hardware-deposit-pill-${
                      latestDeposit.status === 'shipped'
                        ? 'shipped'
                        : latestDeposit.status === 'paid'
                          ? latestDeposit.receiver_name
                            ? 'addressed'
                            : 'paid'
                          : 'created'
                    }`}
                  >
                    {latestDeposit.status === 'shipped'
                      ? t('pricing.hardware.deposit.statusShipped')
                      : latestDeposit.status === 'paid'
                        ? latestDeposit.receiver_name
                          ? t('pricing.hardware.deposit.statusAddressed')
                          : t('pricing.hardware.deposit.statusPaid')
                        : t('pricing.hardware.deposit.statusCreated')}
                  </span>
                </p>
              )}
            </div>
            <div className='pricing-hardware-deposit-actions'>
              <button
                type='button'
                className='pricing-deposit-cta'
                disabled={depositSubmitting}
                onClick={() => void handleDepositPay()}
              >
                {depositSubmitting
                  ? t('pricing.hardware.deposit.payCtaBusy')
                  : t('pricing.hardware.deposit.payCta', {
                      amount: HARDWARE_DEPOSIT_CNY.toLocaleString('zh-CN'),
                    })}
              </button>
              {latestDeposit && latestDeposit.status !== 'created' && (
                <button
                  type='button'
                  className='pricing-deposit-addr-btn'
                  disabled={latestDeposit.status === 'shipped'}
                  onClick={() => openAddressForm(latestDeposit.reqsn)}
                >
                  {latestDeposit.status === 'shipped'
                    ? t('pricing.hardware.deposit.statusShipped')
                    : latestDeposit.receiver_name
                      ? t('pricing.hardware.deposit.editAddress')
                      : t('pricing.hardware.deposit.fillAddress')}
                </button>
              )}
            </div>
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
          <div className='pricing-matrix-table-wrap' ref={matrixWrapRef}>
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
          {matrixScrollable && (
            <p className='pricing-matrix-scroll-hint'>{t('pricing.matrix.scrollHint')}</p>
          )}
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
            {qrStatus === 'paid' && qrOrder.kind === 'hardware' ? (
              // 押金付完还差一步收货地址：不走「完成」而是直接进地址表单，
              // 否则用户会以为流程结束，后台却拿不到地址、发不了货。
              <button
                type='button'
                className='pricing-qr-close pricing-qr-continue'
                onClick={goToAddressForm}
              >
                {t('pricing.hardware.deposit.goAddress')}
              </button>
            ) : (
              <button type='button' className='pricing-qr-close' onClick={closeQr}>
                {qrStatus === 'paid' ? '完成' : '关闭'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 硬件押金：收货地址表单（支付成功后打开；已发货则只读） */}
      {addressFor && (
        <div className='pricing-qr-overlay' onClick={() => setAddressFor(null)}>
          <div className='pricing-qr-card' onClick={(e) => e.stopPropagation()}>
            <h2 className='pricing-qr-title'>{t('pricing.hardware.deposit.addressTitle')}</h2>
            <p className='pricing-qr-subtitle'>
              {t('pricing.hardware.deposit.addressSubtitle')}
              <br />
              {t('pricing.hardware.deposit.myOrder')} <code>{addressFor}</code>
            </p>
            {addressShipped ? (
              <p className='pricing-address-locked'>
                {t('pricing.hardware.deposit.addressLocked')}
              </p>
            ) : (
              <div className='pricing-address-form'>
                <label className='pricing-address-field'>
                  <span>{t('pricing.hardware.deposit.fieldName')}</span>
                  <input
                    value={addrName}
                    maxLength={40}
                    onChange={(e) => setAddrName(e.target.value)}
                    placeholder={t('pricing.hardware.deposit.fieldNamePlaceholder')}
                  />
                </label>
                <label className='pricing-address-field'>
                  <span>{t('pricing.hardware.deposit.fieldPhone')}</span>
                  <input
                    value={addrPhone}
                    maxLength={24}
                    onChange={(e) => setAddrPhone(e.target.value)}
                    placeholder={t('pricing.hardware.deposit.fieldPhonePlaceholder')}
                  />
                </label>
                <label className='pricing-address-field'>
                  <span>{t('pricing.hardware.deposit.fieldRegion')}</span>
                  <input
                    value={addrRegion}
                    maxLength={60}
                    onChange={(e) => setAddrRegion(e.target.value)}
                    placeholder={t('pricing.hardware.deposit.fieldRegionPlaceholder')}
                  />
                </label>
                <label className='pricing-address-field pricing-address-field-wide'>
                  <span>{t('pricing.hardware.deposit.fieldDetail')}</span>
                  <input
                    value={addrDetail}
                    maxLength={200}
                    onChange={(e) => setAddrDetail(e.target.value)}
                    placeholder={t('pricing.hardware.deposit.fieldDetailPlaceholder')}
                  />
                </label>
                <label className='pricing-address-field pricing-address-field-wide'>
                  <span>{t('pricing.hardware.deposit.fieldRemark')}</span>
                  <input
                    value={addrRemark}
                    maxLength={200}
                    onChange={(e) => setAddrRemark(e.target.value)}
                    placeholder={t('pricing.hardware.deposit.fieldRemarkPlaceholder')}
                  />
                </label>
              </div>
            )}
            <div className='pricing-address-actions'>
              <button
                type='button'
                className='pricing-text-btn'
                onClick={() => setAddressFor(null)}
              >
                {t('pricing.hardware.deposit.close')}
              </button>
              {!addressShipped && (
                <button
                  type='button'
                  className='pricing-qr-close pricing-qr-continue'
                  disabled={addrSubmitting}
                  onClick={() => void submitAddress()}
                >
                  {addrSubmitting
                    ? t('pricing.hardware.deposit.submitting')
                    : t('pricing.hardware.deposit.submit')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PricingPage;
