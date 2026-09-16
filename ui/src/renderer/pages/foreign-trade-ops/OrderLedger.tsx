/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Message, Modal, Select } from '@arco-design/web-react';
import { Delete, Download, Edit, Plus, Search, Upload } from '@icon-park/react';
import classNames from 'classnames';

/** 跟单阶段，按实际推进顺序排列。 */
export const ORDER_STAGES = [
  'quote',
  'sample',
  'ordered',
  'producing',
  'inspecting',
  'shipped',
  'customs',
  'paid',
  'done',
] as const;

export type OrderStage = (typeof ORDER_STAGES)[number];

/** 一个订单要集的单据，键同时用于界面文案与生成器跳转。 */
export const ORDER_DOC_KEYS = ['pi', 'ci', 'pl', 'bl', 'co', 'ins', 'insp', 'fum'] as const;

export type OrderDocKey = (typeof ORDER_DOC_KEYS)[number];

export type OrderDocs = Partial<Record<OrderDocKey, boolean>>;

/** 单据 → 内置单证生成器页面。 */
const DOC_TO_FILE: Record<OrderDocKey, string> = {
  pi: 'proforma-invoice.html',
  ci: 'commercial-invoice.html',
  pl: 'packing-list.html',
  bl: 'bill-of-lading.html',
  co: 'certificate-of-origin.html',
  ins: 'insurance-policy.html',
  insp: 'inspection-certificate.html',
  fum: 'fumigation-certificate.html',
};

/** 单据键 → `common.tradeFollowUp.ledger.*` 文案键（显式映射，避免拼缀出错）。 */
const DOC_LABEL_KEY: Record<OrderDocKey, string> = {
  pi: 'docPi',
  ci: 'docCi',
  pl: 'docPl',
  bl: 'docBl',
  co: 'docCo',
  ins: 'docIns',
  insp: 'docInsp',
  fum: 'docFum',
};

export interface FollowUpOrder {
  id: string;
  no: string;
  customer: string;
  country: string;
  product: string;
  qty: string;
  amount: string;
  currency: string;
  incoterm: string;
  payment: string;
  stage: OrderStage;
  orderDate: string;
  deliveryDate: string;
  docs: OrderDocs;
  note: string;
}

const STORAGE_KEY = 'geekclaw.trade-follow-up.orders.v1';

const CURRENCIES = ['USD', 'EUR', 'CNY', 'GBP', 'JPY', 'AUD', 'CAD', 'RUB'];

const INCOTERMS = ['EXW', 'FOB', 'CFR', 'CIF', 'DDP', 'DAP', 'FCA', 'CIP'];

function uid(): string {
  // 订单 id 只在本机使用，时间戳 + 随机后缀足够。
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 距交期的天数（负数=已逾期）。 */
function daysUntil(date: string): number | null {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

function docScore(docs: OrderDocs): number {
  const done = ORDER_DOC_KEYS.filter((key) => docs[key]).length;
  return Math.round((done / ORDER_DOC_KEYS.length) * 100);
}

function loadOrders(): FollowUpOrder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is FollowUpOrder => !!item && typeof item === 'object' && 'id' in item);
  } catch {
    return [];
  }
}

function emptyOrder(): FollowUpOrder {
  return {
    id: uid(),
    no: '',
    customer: '',
    country: '',
    product: '',
    qty: '',
    amount: '',
    currency: 'USD',
    incoterm: 'FOB',
    payment: '',
    stage: 'quote',
    orderDate: today(),
    deliveryDate: '',
    docs: {},
    note: '',
  };
}

interface OrderLedgerProps {
  /** 点「去生成」时切换到单证工具箱的对应页面。 */
  onGenerateDoc: (file: string) => void;
}

/**
 * OrderLedger — 订单跟单台账。
 *
 * 与单证工具箱互补：工具箱负责「把单证做出来」，台账负责「盯着每张订单的
 * 阶段、交期和单据齐套情况」。数据只存本机 localStorage，可导出 CSV / JSON 备份。
 */
const OrderLedger: React.FC<OrderLedgerProps> = ({ onGenerateDoc }) => {
  const { t } = useTranslation();

  const [orders, setOrders] = useState<FollowUpOrder[]>(() => loadOrders());
  const [keyword, setKeyword] = useState('');
  const [stageFilter, setStageFilter] = useState<OrderStage | 'all'>('all');
  const [editing, setEditing] = useState<FollowUpOrder | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 本地持久化
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
    } catch {
      /* 存储不可用时静默降级为内存态 */
    }
  }, [orders]);

  const stageLabel = useCallback(
    (stage: OrderStage) => t(`common.tradeFollowUp.ledger.stage.${stage}`),
    [t]
  );

  const stageOptions = useMemo(
    () => [
      { label: t('common.tradeFollowUp.ledger.allStages'), value: 'all' },
      ...ORDER_STAGES.map((stage) => ({ label: stageLabel(stage), value: stage })),
    ],
    [t, stageLabel]
  );

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return orders.filter((order) => {
      if (stageFilter !== 'all' && order.stage !== stageFilter) return false;
      if (!kw) return true;
      return [order.no, order.customer, order.product, order.country, order.note]
        .join(' ')
        .toLowerCase()
        .includes(kw);
    });
  }, [orders, keyword, stageFilter]);

  const stats = useMemo(() => {
    const active = orders.filter((order) => order.stage !== 'done');
    const total = orders.reduce((sum, order) => {
      // 金额字段允许用户写「12,000.50」，只取数字部分求和。
      const value = Number.parseFloat(order.amount.replace(/[^\d.-]/g, ''));
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
    let overdue = 0;
    let dueSoon = 0;
    for (const order of active) {
      const days = daysUntil(order.deliveryDate);
      if (days === null) continue;
      if (days < 0) overdue += 1;
      else if (days <= 7) dueSoon += 1;
    }
    const score =
      orders.length === 0
        ? 0
        : Math.round(orders.reduce((sum, order) => sum + docScore(order.docs), 0) / orders.length);
    return { active: active.length, total, overdue, dueSoon, score };
  }, [orders]);

  const saveOrder = useCallback(
    (draft: FollowUpOrder) => {
      setOrders((prev) => {
        const exists = prev.some((item) => item.id === draft.id);
        return exists ? prev.map((item) => (item.id === draft.id ? draft : item)) : [draft, ...prev];
      });
      setEditing(null);
      Message.success(t('common.tradeFollowUp.ledger.saved'));
    },
    [t]
  );

  const removeOrder = useCallback(
    (id: string) => {
      Modal.confirm({
        title: t('common.tradeFollowUp.ledger.delete'),
        content: t('common.tradeFollowUp.ledger.confirmDelete'),
        okButtonProps: { status: 'danger' },
        onOk: () => {
          setOrders((prev) => prev.filter((item) => item.id !== id));
          Message.success(t('common.tradeFollowUp.ledger.deleted'));
        },
      });
    },
    [t]
  );

  const exportCsv = useCallback(() => {
    const header = [
      t('common.tradeFollowUp.ledger.colNo'),
      t('common.tradeFollowUp.ledger.colCustomer'),
      t('common.tradeFollowUp.ledger.fieldCountry'),
      t('common.tradeFollowUp.ledger.colProduct'),
      t('common.tradeFollowUp.ledger.fieldQty'),
      t('common.tradeFollowUp.ledger.colAmount'),
      t('common.tradeFollowUp.ledger.fieldCurrency'),
      t('common.tradeFollowUp.ledger.fieldIncoterm'),
      t('common.tradeFollowUp.ledger.fieldPayment'),
      t('common.tradeFollowUp.ledger.colStage'),
      t('common.tradeFollowUp.ledger.fieldOrderDate'),
      t('common.tradeFollowUp.ledger.colDelivery'),
      t('common.tradeFollowUp.ledger.statDocs'),
      t('common.tradeFollowUp.ledger.fieldNote'),
    ];
    const rows = orders.map((order) => [
      order.no,
      order.customer,
      order.country,
      order.product,
      order.qty,
      order.amount,
      order.currency,
      order.incoterm,
      order.payment,
      stageLabel(order.stage),
      order.orderDate,
      order.deliveryDate,
      `${docScore(order.docs)}%`,
      order.note,
    ]);
    const escape = (value: string) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    // 带 BOM，保证 Excel 打开中文不乱码。
    const csv = '\ufeff' + [header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `trade-follow-up-${today()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    Message.success(t('common.tradeFollowUp.ledger.exported'));
  }, [orders, stageLabel, t]);

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(orders, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `trade-follow-up-backup-${today()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [orders]);

  const importJson = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error('not an array');
        const incoming = parsed.filter((item) => item && typeof item === 'object' && 'id' in item);
        setOrders((prev) => {
          const seen = new Set(prev.map((item) => item.id));
          const merged = [...prev];
          for (const item of incoming as FollowUpOrder[]) {
            if (!seen.has(item.id)) {
              seen.add(item.id);
              merged.push(item);
            }
          }
          return merged;
        });
        Message.success(t('common.tradeFollowUp.ledger.imported', { count: incoming.length }));
      } catch {
        Message.error(t('common.tradeFollowUp.ledger.importFailed'));
      }
    },
    [t]
  );

  return (
    <div className='flex-1 min-h-0 flex flex-col'>
      {/* 概览 */}
      <div className='shrink-0 px-16px pt-14px pb-10px flex flex-wrap items-stretch gap-10px'>
        <StatCard label={t('common.tradeFollowUp.ledger.statOrders')} value={stats.active} />
        <StatCard
          label={t('common.tradeFollowUp.ledger.statAmount')}
          value={stats.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        />
        <StatCard
          label={t('common.tradeFollowUp.ledger.statOverdue')}
          value={stats.overdue}
          tone={stats.overdue > 0 ? 'danger' : 'default'}
        />
        <StatCard
          label={t('common.tradeFollowUp.ledger.statDueSoon')}
          value={stats.dueSoon}
          tone={stats.dueSoon > 0 ? 'warning' : 'default'}
        />
        <StatCard label={t('common.tradeFollowUp.ledger.statDocs')} value={`${stats.score}%`} />
      </div>

      {/* 工具条 */}
      <div className='shrink-0 px-16px pb-10px flex flex-wrap items-center gap-8px'>
        <Input
          size='small'
          allowClear
          value={keyword}
          onChange={setKeyword}
          prefix={<Search theme='outline' size={13} />}
          placeholder={t('common.tradeFollowUp.ledger.searchPlaceholder')}
          className='max-w-260px'
        />
        <Select
          size='small'
          value={stageFilter}
          onChange={(value) => setStageFilter(value as OrderStage | 'all')}
          options={stageOptions}
          style={{ width: 132 }}
        />
        <div className='flex-1' />
        <input
          ref={fileRef}
          type='file'
          accept='.json,application/json'
          className='hidden'
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importJson(file);
            event.target.value = '';
          }}
        />
        <Button size='small' icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>
          {t('common.tradeFollowUp.ledger.importJson')}
        </Button>
        <Button size='small' icon={<Download size={14} />} onClick={exportJson}>
          {t('common.tradeFollowUp.ledger.exportJson')}
        </Button>
        <Button size='small' icon={<Download size={14} />} onClick={exportCsv} disabled={orders.length === 0}>
          {t('common.tradeFollowUp.ledger.exportCsv')}
        </Button>
        <Button size='small' type='primary' icon={<Plus size={14} />} onClick={() => setEditing(emptyOrder())}>
          {t('common.tradeFollowUp.ledger.new')}
        </Button>
      </div>

      {/* 列表 */}
      <div className='flex-1 min-h-0 overflow-auto px-16px pb-24px'>
        {orders.length === 0 ? (
          <div className='h-full min-h-320px flex flex-col items-center justify-center gap-8px text-center'>
            <span className='text-14px font-500 text-t-primary'>
              {t('common.tradeFollowUp.ledger.empty')}
            </span>
            <span className='max-w-420px text-12px leading-20px text-t-tertiary'>
              {t('common.tradeFollowUp.ledger.emptyHint')}
            </span>
          </div>
        ) : visible.length === 0 ? (
          <div className='h-full min-h-240px flex items-center justify-center text-13px text-t-tertiary'>
            {t('common.tradeFollowUp.ledger.emptyFiltered')}
          </div>
        ) : (
          <table className='w-full border-collapse text-13px'>
            <thead>
              <tr className='text-left text-12px text-t-tertiary'>
                {[
                  t('common.tradeFollowUp.ledger.colNo'),
                  t('common.tradeFollowUp.ledger.colCustomer'),
                  t('common.tradeFollowUp.ledger.colProduct'),
                  t('common.tradeFollowUp.ledger.colAmount'),
                  t('common.tradeFollowUp.ledger.colStage'),
                  t('common.tradeFollowUp.ledger.colDelivery'),
                  t('common.tradeFollowUp.ledger.colDocs'),
                  t('common.tradeFollowUp.ledger.colActions'),
                ].map((label) => (
                  <th
                    key={label}
                    className='sticky top-0 z-1 bg-[var(--color-bg-2)] border-b border-[var(--color-border-2)] py-8px px-10px font-[500] whitespace-nowrap'
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((order) => {
                const days = daysUntil(order.deliveryDate);
                const finished = order.stage === 'done' || order.stage === 'paid';
                const overdue = !finished && days !== null && days < 0;
                const dueSoon = !finished && days !== null && days >= 0 && days <= 7;
                const score = docScore(order.docs);
                const missing = ORDER_DOC_KEYS.filter((key) => !order.docs[key]);
                return (
                  <tr key={order.id} className='align-top hover:bg-fill-1'>
                    <td className='border-b border-[var(--color-border-2)] py-10px px-10px font-500 whitespace-nowrap'>
                      {order.no || <span className='text-t-tertiary'>—</span>}
                    </td>
                    <td className='border-b border-[var(--color-border-2)] py-10px px-10px'>
                      <div className='flex flex-col gap-2px'>
                        <span>{order.customer || <span className='text-t-tertiary'>—</span>}</span>
                        {order.country && <span className='text-11px text-t-tertiary'>{order.country}</span>}
                      </div>
                    </td>
                    <td className='border-b border-[var(--color-border-2)] py-10px px-10px max-w-200px'>
                      <div className='flex flex-col gap-2px'>
                        <span className='break-words'>{order.product || <span className='text-t-tertiary'>—</span>}</span>
                        {order.qty && <span className='text-11px text-t-tertiary'>{order.qty}</span>}
                      </div>
                    </td>
                    <td className='border-b border-[var(--color-border-2)] py-10px px-10px whitespace-nowrap'>
                      {order.amount ? `${order.currency} ${order.amount}` : <span className='text-t-tertiary'>—</span>}
                    </td>
                    <td className='border-b border-[var(--color-border-2)] py-10px px-10px whitespace-nowrap'>
                      <span className='inline-flex items-center h-20px px-8px rd-10px text-11px bg-[var(--color-fill-2)] text-t-secondary'>
                        {stageLabel(order.stage)}
                      </span>
                    </td>
                    <td className='border-b border-[var(--color-border-2)] py-10px px-10px whitespace-nowrap'>
                      {days === null ? (
                        <span className='text-t-tertiary'>{t('common.tradeFollowUp.ledger.noDelivery')}</span>
                      ) : (
                        <div className='flex flex-col gap-2px'>
                          <span>{order.deliveryDate}</span>
                          <span
                            className={classNames(
                              'text-11px',
                              overdue ? 'text-danger' : dueSoon ? 'text-warning' : 'text-t-tertiary'
                            )}
                          >
                            {overdue
                              ? t('common.tradeFollowUp.ledger.overdue', { days: Math.abs(days) })
                              : days === 0
                                ? t('common.tradeFollowUp.ledger.dueToday')
                                : t('common.tradeFollowUp.ledger.dueSoon', { days })}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className='border-b border-[var(--color-border-2)] py-10px px-10px'>
                      <div className='flex flex-col gap-4px min-w-110px'>
                        <div className='flex items-center gap-6px'>
                          <div className='flex-1 h-4px rd-2px bg-[var(--color-fill-2)] overflow-hidden'>
                            <div
                              className={classNames('h-full', score === 100 ? 'bg-success' : 'bg-primary-6')}
                              style={{ width: `${score}%` }}
                            />
                          </div>
                          <span className='text-11px text-t-tertiary w-30px text-right'>{score}%</span>
                        </div>
                        {missing.length > 0 && (
                          <div className='flex flex-wrap gap-3px'>
                            {missing.map((key) => (
                              <button
                                key={key}
                                onClick={() => onGenerateDoc(DOC_TO_FILE[key])}
                                title={`${t(`common.tradeFollowUp.ledger.${DOC_LABEL_KEY[key]}`)} → ${t('common.tradeFollowUp.ledger.generate')}`}
                                className='h-18px px-5px rd-4px text-10px border border-dashed border-[var(--color-border-3)] text-t-tertiary bg-transparent hover:border-primary-6 hover:text-primary-6 cursor-pointer transition-colors'
                              >
                                {t(`common.tradeFollowUp.ledger.${DOC_LABEL_KEY[key]}`)}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className='border-b border-[var(--color-border-2)] py-10px px-10px whitespace-nowrap'>
                      <div className='flex items-center gap-4px'>
                        <button
                          onClick={() => setEditing(order)}
                          title={t('common.tradeFollowUp.ledger.edit')}
                          className='size-26px inline-flex items-center justify-center rd-6px border border-[var(--color-border-2)] bg-transparent text-t-secondary hover:text-primary-6 hover:border-primary-6 cursor-pointer transition-colors'
                        >
                          <Edit theme='outline' size={13} />
                        </button>
                        <button
                          onClick={() => removeOrder(order.id)}
                          title={t('common.tradeFollowUp.ledger.delete')}
                          className='size-26px inline-flex items-center justify-center rd-6px border border-[var(--color-border-2)] bg-transparent text-t-secondary hover:text-danger hover:border-danger cursor-pointer transition-colors'
                        >
                          <Delete theme='outline' size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <OrderEditorModal
          draft={editing}
          stageOptions={ORDER_STAGES.map((stage) => ({ label: stageLabel(stage), value: stage }))}
          onCancel={() => setEditing(null)}
          onSave={saveOrder}
          onGenerateDoc={onGenerateDoc}
        />
      )}
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: React.ReactNode; tone?: 'default' | 'danger' | 'warning' }> = ({
  label,
  value,
  tone = 'default',
}) => (
  <div className='min-w-120px flex-1 px-14px py-10px rd-10px border border-[var(--color-border-2)] bg-[var(--color-bg-2)]'>
    <div className='text-11px text-t-tertiary mb-4px'>{label}</div>
    <div
      className={classNames(
        'text-18px font-600 leading-24px',
        tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-t-primary'
      )}
    >
      {value}
    </div>
  </div>
);

interface OrderEditorModalProps {
  draft: FollowUpOrder;
  stageOptions: Array<{ label: string; value: OrderStage }>;
  onCancel: () => void;
  onSave: (draft: FollowUpOrder) => void;
  onGenerateDoc: (file: string) => void;
}

const OrderEditorModal: React.FC<OrderEditorModalProps> = ({
  draft,
  stageOptions,
  onCancel,
  onSave,
  onGenerateDoc,
}) => {
  const { t } = useTranslation();
  const [form, setForm] = useState<FollowUpOrder>(draft);

  const set = <K extends keyof FollowUpOrder>(key: K, value: FollowUpOrder[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const field = (label: string, node: React.ReactNode) => (
    <label className='flex flex-col gap-5px'>
      <span className='text-12px text-t-secondary'>{label}</span>
      {node}
    </label>
  );

  return (
    <Modal
      visible
      title={draft.no ? t('common.tradeFollowUp.ledger.edit') : t('common.tradeFollowUp.ledger.new')}
      style={{ width: 760 }}
      onCancel={onCancel}
      onOk={() => onSave(form)}
      okText={t('common.tradeFollowUp.ledger.save')}
      cancelText={t('common.tradeFollowUp.ledger.cancel')}
      autoFocus={false}
    >
      <div className='grid grid-cols-1 sm:grid-cols-2 gap-12px'>
        {field(
          t('common.tradeFollowUp.ledger.fieldNo'),
          <Input value={form.no} onChange={(value) => set('no', value)} placeholder='PO-2026-001' />
        )}
        {field(
          t('common.tradeFollowUp.ledger.fieldCustomer'),
          <Input value={form.customer} onChange={(value) => set('customer', value)} />
        )}
        {field(
          t('common.tradeFollowUp.ledger.fieldCountry'),
          <Input value={form.country} onChange={(value) => set('country', value)} placeholder='Germany' />
        )}
        {field(
          t('common.tradeFollowUp.ledger.fieldProduct'),
          <Input value={form.product} onChange={(value) => set('product', value)} />
        )}
        {field(
          t('common.tradeFollowUp.ledger.fieldQty'),
          <Input value={form.qty} onChange={(value) => set('qty', value)} placeholder='1 x 20GP / 5,000 pcs' />
        )}
        <div className='grid grid-cols-[1fr_96px] gap-8px'>
          {field(
            t('common.tradeFollowUp.ledger.fieldAmount'),
            <Input value={form.amount} onChange={(value) => set('amount', value)} placeholder='12500.00' />
          )}
          {field(
            t('common.tradeFollowUp.ledger.fieldCurrency'),
            <Select value={form.currency} onChange={(value) => set('currency', value as string)} options={CURRENCIES} />
          )}
        </div>
        {field(
          t('common.tradeFollowUp.ledger.fieldIncoterm'),
          <Select value={form.incoterm} onChange={(value) => set('incoterm', value as string)} options={INCOTERMS} />
        )}
        {field(
          t('common.tradeFollowUp.ledger.fieldPayment'),
          <Input
            value={form.payment}
            onChange={(value) => set('payment', value)}
            placeholder='T/T 30% + 70% before shipment'
          />
        )}
        {field(
          t('common.tradeFollowUp.ledger.fieldStage'),
          <Select
            value={form.stage}
            onChange={(value) => set('stage', value as OrderStage)}
            options={stageOptions}
          />
        )}
        {field(
          t('common.tradeFollowUp.ledger.fieldOrderDate'),
          <input
            type='date'
            value={form.orderDate}
            onChange={(event) => set('orderDate', event.target.value)}
            className='h-32px px-10px rd-4px text-13px border border-[var(--color-border-3)] bg-[var(--color-bg-2)] text-t-primary outline-none focus:border-primary-6'
          />
        )}
        {field(
          t('common.tradeFollowUp.ledger.fieldDeliveryDate'),
          <input
            type='date'
            value={form.deliveryDate}
            onChange={(event) => set('deliveryDate', event.target.value)}
            className='h-32px px-10px rd-4px text-13px border border-[var(--color-border-3)] bg-[var(--color-bg-2)] text-t-primary outline-none focus:border-primary-6'
          />
        )}
      </div>

      <div className='mt-16px'>
        <div className='text-12px text-t-secondary mb-8px'>{t('common.tradeFollowUp.ledger.docsSection')}</div>
        <div className='grid grid-cols-2 sm:grid-cols-4 gap-8px'>
          {ORDER_DOC_KEYS.map((key) => {
            const checked = !!form.docs[key];
            return (
              <div
                key={key}
                className={classNames(
                  'h-32px px-10px rd-8px flex items-center justify-between gap-6px border transition-colors cursor-pointer',
                  checked
                    ? 'border-primary-6 bg-primary-1 text-primary-6'
                    : 'border-[var(--color-border-2)] bg-[var(--color-bg-2)] text-t-secondary'
                )}
                onClick={() => set('docs', { ...form.docs, [key]: !checked })}
              >
                <span className='text-12px truncate'>
                  {t(`common.tradeFollowUp.ledger.${DOC_LABEL_KEY[key]}`)}
                </span>
                {!checked && (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      // 先关掉弹窗再跳转，否则工具箱会被遮罩挡住。
                      onCancel();
                      onGenerateDoc(DOC_TO_FILE[key]);
                    }}
                    className='shrink-0 text-11px text-primary-6 bg-transparent border-0 cursor-pointer'
                  >
                    {t('common.tradeFollowUp.ledger.generate')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className='mt-16px'>
        <Input.TextArea
          value={form.note}
          onChange={(value) => set('note', value)}
          placeholder={t('common.tradeFollowUp.ledger.fieldNote')}
          autoSize={{ minRows: 2, maxRows: 4 }}
        />
      </div>
    </Modal>
  );
};

export default OrderLedger;
