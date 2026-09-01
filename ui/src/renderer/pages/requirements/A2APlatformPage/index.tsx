/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A2APlatformPage v2 — A2A 跨境电商平台（阿里橙主题 / Hero 中央 / 三栏布局）。
 *
 * 设计参考 ukenmall.com：
 * - 大标题 + 中央输入框 + 推荐 chip
 * - 左侧栏（新建对话 / 智能体 / 搜索对话）
 * - 主区（聊天流 + AI 推荐商品网格）
 * - 右侧 LIVE 购物卡（实时心跳 + 模型 + 语言状态）
 * - 顶部 AI 模型选择器 + 11 语言切换器
 *
 * 技术含金量 / IP 壁垒：
 * - AI 多模型路由器（用户可切 Qwen / DeepSeek / ChatGPT / 文心 / 文生图）
 * - 本土化大脑（11 语言 / 货币 / RTL / 区域推荐）
 * - 商品多维解构引擎（6 维度叙事，4 种 analysisProfile）
 * - 全球支付聚合（微信 / 支付宝 / Stripe / PayPal / 本地钱包）
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button } from '@arco-design/web-react';
import { Refresh, Send } from '@icon-park/react';
import Sidebar from './components/Sidebar';
import HeroSection from './components/HeroSection';
import ModelSelector from './components/ModelSelector';
import LanguageSwitcher from './components/LanguageSwitcher';
import LiveShoppingCard from './components/LiveShoppingCard';
import ProductCard from './components/ProductCard';
import ProductAnalysisModal from './components/ProductAnalysisModal';
import PaymentDialog from './components/PaymentDialog';
import { BuyerAgent, type A2AOrder } from './buyerAgent';
import { PRODUCTS, type A2AProduct } from './catalog';
import { loadA2AProducts } from './cloudApi';
import { AIModel, loadSelectedModel } from './models';
import { getLocale, loadLocale, type LocaleCode, type PaymentMethod, CURRENCY_SYMBOL } from './localization';
import { A2A_THEME } from './theme';

interface ChatBubble {
  id: number;
  role: 'agent' | 'user';
  text: string;
  products?: A2AProduct[];
  order?: A2AOrder;
}

const A2APlatformPage: React.FC = () => {
  const { t } = useTranslation();
  const agentRef = useRef<BuyerAgent | null>(null);
  if (!agentRef.current) agentRef.current = new BuyerAgent();
  const agent = agentRef.current;

  // 模型 / 语言状态
  const [model, setModel] = useState<AIModel>(() => loadSelectedModel());
  const [localeCode, setLocaleCode] = useState<LocaleCode>(() => loadLocale());
  const localeInfo = useMemo(() => getLocale(localeCode), [localeCode]);

  // 商品源
  const [source, setSource] = useState<'cloud' | 'local' | 'loading'>('loading');

  // 会话
  const [sessionId, setSessionId] = useState(() => agent.newSessionId());
  const [sessions, setSessions] = useState<{ id: string; title: string; preview: string }[]>([]);
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const nextIdRef = useRef(1);

  // 输入
  const [chatInput, setChatInput] = useState('');
  const [busy, setBusy] = useState(false);

  // 弹窗状态
  const [analyzeProduct, setAnalyzeProduct] = useState<A2AProduct | null>(null);
  const [payProduct, setPayProduct] = useState<A2AProduct | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // 加载商品（云端优先，本地降级）
  useEffect(() => {
    let disposed = false;
    void (async () => {
      const { source: src, products } = await loadA2AProducts();
      if (disposed) return;
      agent.setProducts(products);
      setSource(src);
    })();
    return () => {
      disposed = true;
    };
  }, [agent]);

  const pushAgent = useCallback((reply: ReturnType<BuyerAgent['handle']>, userText?: string) => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    const bubble: ChatBubble = {
      id,
      role: 'agent',
      text: reply.message,
      products: 'products' in reply ? reply.products : undefined,
      order: 'order' in reply ? reply.order : undefined,
    };
    setBubbles((prev) => {
      const next = userText !== undefined ? [...prev, { id: 0, role: 'user' as const, text: userText }] : prev;
      return [...next, bubble];
    });

    // 更新会话列表
    if (userText) {
      setSessions((prev) => {
        const existing = prev.find((s) => s.id === sessionId);
        if (existing) {
          return prev.map((s) =>
            s.id === sessionId ? { ...s, preview: userText.slice(0, 40) } : s
          );
        }
        return [
          ...prev,
          {
            id: sessionId,
            title: userText.slice(0, 16) || t('requirements.a2a.platform.sidebar.newChat'),
            preview: userText.slice(0, 40),
          },
        ];
      });
    }

    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, [sessionId, t]);

  const sendMessage = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      const id = nextIdRef.current;
      nextIdRef.current += 1;
      setBubbles((prev) => [...prev, { id, role: 'user', text }]);
      setChatInput('');
      setBusy(true);
      try {
        const reply = agent.handle(text, sessionId);
        pushAgent(reply);
      } finally {
        setBusy(false);
      }
    },
    [agent, busy, pushAgent, sessionId]
  );

  const handleNewSession = useCallback(() => {
    const newId = agent.newSessionId();
    setSessionId(newId);
    nextIdRef.current = 1;
    setBubbles([]);
  }, [agent]);

  const handleBuy = useCallback(
    (p: A2AProduct) => {
      setPayProduct(p);
    },
    []
  );

  const handlePay = useCallback(
    (method: PaymentMethod, qty: number) => {
      if (!payProduct) return;
      // mock：模拟订单生成（按 qty 复制）
      const order: A2AOrder = {
        product: payProduct,
        orderId: `A2A${Date.now()}`,
        amountCny: payProduct.price_cny * qty,
        method,
        quantity: qty,
        paidAt: new Date().toISOString(),
      };
      // 在对话区显示支付成功气泡
      const reply = {
        type: 'paid' as const,
        message: `支付成功！订单 ${order.orderId}（${method}，${qty} 件，¥${order.amountCny}）已进入跨境直邮流程。`,
        order,
      };
      pushAgent(reply);
      setPayProduct(null);
    },
    [payProduct, pushAgent]
  );

  const handleReset = useCallback(() => {
    handleNewSession();
  }, [handleNewSession]);

  // 推荐 chip（按区域动态生成）
  const chips = useMemo(() => {
    const base = [
      t('requirements.a2a.platform.chips.recommend0'),
      t('requirements.a2a.platform.chips.recommend1'),
      t('requirements.a2a.platform.chips.recommend2'),
      t('requirements.a2a.platform.chips.recommend3'),
      t('requirements.a2a.platform.chips.recommend4'),
      t('requirements.a2a.platform.chips.recommend5'),
    ];
    if (localeInfo.region === 'JP') {
      base.push(t('requirements.a2a.platform.chips.japan0'));
      base.push(t('requirements.a2a.platform.chips.japan1'));
    }
    if (localeInfo.region === 'EU') {
      base.push(t('requirements.a2a.platform.chips.eu0'));
    }
    return base;
  }, [t, localeInfo.region]);

  // 商品推荐网格（取前 8 个）
  const featuredProducts = useMemo(() => PRODUCTS.slice(0, 8), []);

  // source badge
  const sourceBadge =
    source === 'cloud' ? (
      <Badge status='success' text={t('requirements.a2a.platform.sourceCloud')} />
    ) : source === 'local' ? (
      <Badge status='warning' text={t('requirements.a2a.platform.sourceLocal')} />
    ) : (
      <Badge status='processing' text={t('requirements.a2a.platform.sourceLoading')} />
    );

  return (
    <div className='flex flex-col gap-20px' dir={localeInfo.rtl ? 'rtl' : 'ltr'}>
      {/* 顶部工具栏 */}
      <div className='flex items-center justify-between gap-12px flex-wrap'>
        <div className='flex items-center gap-10px'>
          {sourceBadge}
          <span className='text-12px text-t-tertiary'>
            {t('requirements.a2a.platform.barcode')}
          </span>
        </div>
        <div className='flex items-center gap-10px'>
          <ModelSelector onModelChange={setModel} />
          <LanguageSwitcher onChange={setLocaleCode} />
          <Button size='small' icon={<Refresh theme='outline' size='15' />} onClick={handleReset}>
            {t('requirements.a2a.platform.reset')}
          </Button>
        </div>
      </div>

      {/* 三栏布局：sidebar + main + live */}
      <div className='grid grid-cols-[200px_1fr-1fr_280px] gap-16px'>
        {/* 左 sidebar */}
        <aside className='hidden md:flex flex-col'>
          <Sidebar
            sessions={sessions}
            activeId={sessionId}
            onNew={handleNewSession}
            onSelect={(id) => setSessionId(id)}
            rtl={localeInfo.rtl}
          />
        </aside>

        {/* 主区 */}
        <main className='flex flex-col gap-16px min-w-0'>
          {/* Hero */}
          <HeroSection chips={chips} rtl={localeInfo.rtl} onSend={sendMessage} busy={busy} />

          {/* 聊天区（仅在有消息时显示） */}
          {bubbles.length > 0 && (
            <div
              ref={scrollRef}
              className='flex flex-col gap-12px max-h-[40vh] overflow-y-auto rounded-16px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-1)] p-16px'
            >
              {bubbles.map((b) => {
                if (b.id === 0) {
                  return (
                    <div
                      key={`u-${b.id}-${Math.random()}`}
                      className='self-end max-w-[80%] rounded-14px px-12px py-8px text-13px leading-20px whitespace-pre-wrap break-words'
                      style={{ background: A2A_THEME.primary, color: A2A_THEME.onPrimary }}
                    >
                      {b.text}
                    </div>
                  );
                }
                return (
                  <div
                    key={b.id}
                    className='self-start max-w-[85%] flex flex-col gap-8px'
                  >
                    <div className='rounded-14px bg-[var(--color-fill-2)] text-t-primary px-12px py-8px text-13px leading-20px whitespace-pre-wrap break-words'>
                      {b.text}
                    </div>
                    {b.products && b.products.length > 0 && (
                      <div className='grid grid-cols-2 sm:grid-cols-4 gap-10px'>
                        {b.products.slice(0, 4).map((p) => (
                          <ProductCard
                            key={p.id}
                            product={p}
                            region={localeInfo.region}
                            currency={localeInfo.currency}
                            onAnalyze={setAnalyzeProduct}
                            onBuy={handleBuy}
                          />
                        ))}
                      </div>
                    )}
                    {b.order && (
                      <div
                        className='rounded-12px border border-solid p-12px text-12px'
                        style={{ borderColor: A2A_THEME.primary, background: A2A_THEME.primarySoft }}
                      >
                        ✅ {t('requirements.a2a.platform.orderId')}: {b.order.orderId} · {CURRENCY_SYMBOL[localeInfo.currency]}{b.order.amountCny}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* AI 推荐商品网格 */}
          <section className='flex flex-col gap-12px'>
            <div className='flex items-baseline justify-between'>
              <h2 className='text-18px font-700 text-t-primary flex items-center gap-6px'>
                <span style={{ color: A2A_THEME.primary }}>●</span>
                {t('requirements.a2a.platform.featuredTitle')}
              </h2>
              <span className='text-12px text-t-tertiary'>
                {t('requirements.a2a.platform.featuredHint')}
              </span>
            </div>
            <div className='grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-12px'>
              {featuredProducts.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  region={localeInfo.region}
                  currency={localeInfo.currency}
                  onAnalyze={setAnalyzeProduct}
                  onBuy={handleBuy}
                />
              ))}
            </div>
          </section>

          {/* IP 壁垒叙事 */}
          <section
            className='rounded-20px p-20px flex flex-col gap-10px'
            style={{ background: A2A_THEME.primarySoft }}
          >
            <div className='flex items-center gap-6px'>
              <span className='text-16px'>🛡️</span>
              <span className='text-14px font-700 text-t-primary'>
                {t('requirements.a2a.platform.ip.title')}
              </span>
            </div>
            <div className='text-13px leading-22px text-t-secondary'>
              {t('requirements.a2a.platform.ip.body')}
            </div>
          </section>
        </main>

        {/* 右 LIVE 卡片 */}
        <aside className='hidden lg:block'>
          <LiveShoppingCard modelName={model.name} localeLabel={localeInfo.nativeLabel} />
        </aside>
      </div>

      {/* 弹窗 */}
      <ProductAnalysisModal
        product={analyzeProduct}
        model={model}
        analysisProfile={localeInfo.analysisProfile}
        onClose={() => setAnalyzeProduct(null)}
      />
      <PaymentDialog
        product={payProduct}
        availablePayments={localeInfo.payments}
        currencySymbol={CURRENCY_SYMBOL[localeInfo.currency]}
        onClose={() => setPayProduct(null)}
        onPay={handlePay}
      />
    </div>
  );
};

export default A2APlatformPage;