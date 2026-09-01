/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@arco-design/web-react';
import { Close, Minus, Plus, Wechat, Alipay, Paypal } from '@icon-park/react';
import { A2AProduct } from '../catalog';
import { PaymentMethod } from '../localization';
import { A2A_ALIPAY_BLUE, A2A_PAYPAL_BLUE, A2A_STRIPE_PURPLE, A2A_WECHAT_GREEN, A2A_THEME } from '../theme';

interface Props {
  product: A2AProduct | null;
  /** 当前可用支付方式（来自 locale） */
  availablePayments: PaymentMethod[];
  /** 当前货币符号 */
  currencySymbol: string;
  onClose: () => void;
  /** 真实支付回调（接云端收银台） */
  onPay: (method: PaymentMethod, quantity: number) => void;
}

/** 支付方式元数据：标签 + 图标 + 颜色。 */
const PAYMENT_META: Record<PaymentMethod, { labelKey: string; Icon: typeof Wechat; bg: string; hintKey: string }> = {
  wechat: { labelKey: 'wechat', Icon: Wechat, bg: A2A_WECHAT_GREEN, hintKey: 'wechatHint' },
  alipay: { labelKey: 'alipay', Icon: Alipay, bg: A2A_ALIPAY_BLUE, hintKey: 'alipayHint' },
  stripe: { labelKey: 'stripe', Icon: Paypal, bg: A2A_STRIPE_PURPLE, hintKey: 'stripeHint' },
  paypal: { labelKey: 'paypal', Icon: Paypal, bg: A2A_PAYPAL_BLUE, hintKey: 'paypalHint' },
  local: { labelKey: 'local', Icon: Paypal, bg: A2A_THEME.primary, hintKey: 'localHint' },
};

/**
 * 全球支付聚合弹窗（参考 ukenmall 选择支付方式）。
 *
 * - 数量调节 +/-
 * - 按 locale 可用支付方式显示（CN: 微信/支付宝；US/EU: Stripe/PayPal；其他: 本地钱包）
 */
const PaymentDialog: React.FC<Props> = ({ product, availablePayments, currencySymbol, onClose, onPay }) => {
  const { t } = useTranslation();
  const [qty, setQty] = useState(1);
  if (!product) return null;

  const subtotal = product.price_cny * qty;

  return (
    <Modal
      visible={!!product}
      onCancel={onClose}
      footer={null}
      closable={false}
      style={{ borderRadius: 16, overflow: 'hidden', maxWidth: 420, width: '90vw' }}
    >
      <div className='flex flex-col gap-16px p-4px'>
        {/* 标题 */}
        <div className='flex items-center justify-between'>
          <div className='text-16px font-700 text-t-primary'>{t('requirements.a2a.platform.payment.title')}</div>
          <button
            type='button'
            onClick={onClose}
            className='flex-none cursor-pointer border-none bg-transparent p-4px rounded-8px hover:bg-[var(--color-fill-2)]'
          >
            <Close theme='outline' size='16' />
          </button>
        </div>

        {/* 商品行 */}
        <div className='flex items-center gap-10px rounded-12px bg-[var(--color-fill-1)] p-12px'>
          <div className='w-40px h-40px rounded-8px flex-none' style={{ background: 'linear-gradient(135deg, #FFF8F2 0%, #FFEFE0 100%)' }} />
          <div className='flex-1 min-w-0'>
            <div className='text-13px font-600 text-t-primary line-clamp-1'>{product.name}</div>
            <div className='text-11px text-t-tertiary'>{product.tags.slice(0, 2).join(' · ')}</div>
          </div>
          <div className='flex items-center gap-6px'>
            <button
              type='button'
              onClick={() => setQty(Math.max(1, qty - 1))}
              className='cursor-pointer border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-1)] rounded-8px w-24px h-24px flex items-center justify-center hover:border-[var(--color-primary-5)]'
            >
              <Minus theme='outline' size='12' />
            </button>
            <span className='text-13px font-600 text-t-primary min-w-[20px] text-center'>{qty}</span>
            <button
              type='button'
              onClick={() => setQty(qty + 1)}
              className='cursor-pointer border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-1)] rounded-8px w-24px h-24px flex items-center justify-center hover:border-[var(--color-primary-5)]'
            >
              <Plus theme='outline' size='12' />
            </button>
          </div>
          <div className='flex flex-col items-end gap-2px'>
            <div className='text-11px text-t-tertiary'>{t('requirements.a2a.platform.payment.total')}</div>
            <div className='text-15px font-700 text-t-primary'>{currencySymbol}{subtotal}</div>
          </div>
        </div>

        {/* 支付方式 */}
        <div className='flex flex-col gap-8px'>
          {availablePayments.map((p) => {
            const meta = PAYMENT_META[p];
            if (!meta) return null;
            const { Icon, bg, labelKey, hintKey } = meta;
            return (
              <button
                key={p}
                type='button'
                onClick={() => onPay(p, qty)}
                className='flex items-center gap-12px w-full rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-1)] px-14px py-12px cursor-pointer transition-colors hover:border-[var(--color-primary-5)] text-left'
              >
                <div
                  className='flex-none w-36px h-36px rounded-10px flex items-center justify-center'
                  style={{ background: bg }}
                >
                  <Icon theme='filled' size='20' fill='#FFFFFF' />
                </div>
                <div className='flex-1'>
                  <div className='text-14px font-600 text-t-primary'>{t(`requirements.a2a.platform.payment.${labelKey}`)}</div>
                  <div className='text-11px text-t-tertiary'>{t(`requirements.a2a.platform.payment.${hintKey}`)}</div>
                </div>
                <div className='text-t-tertiary text-18px'>›</div>
              </button>
            );
          })}
        </div>

        {/* 安全提示 */}
        <div className='text-11px text-t-tertiary text-center'>
          {t('requirements.a2a.platform.payment.security')}
        </div>
      </div>
    </Modal>
  );
};

export default PaymentDialog;