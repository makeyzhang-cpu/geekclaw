/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A2A 买家 Agent —— 把用户自然语言需求转成「找货 → 比价 → 下单」闭环。
 *
 * 纯前端规则引擎，逻辑对齐手机端调研（A2A 跨境商城 MVP-1 的 agent.py）：
 * - 品类词优先命中商品标签（如「耳机」命中降噪耳机，而非泛化的 3C 类目）；
 * - 预算过滤仅在预算内有货时才收缩，全部超预算则保留并提示；
 * - 排序：评分降序、价格升序；
 * - 可选接 OpenAI 兼容 LLM 生成自然话术（默认关闭，配置 AGENT_LLM_API_KEY 时启用）。
 *
 * 本模块无副作用、可单测，UI 只消费其返回值。
 */

import { CATEGORIES, PRODUCTS, type A2AProduct } from './catalog';

export interface A2ASessionState {
  category?: string;
  budget?: number;
  lastProducts: A2AProduct[];
  order?: A2AOrder;
  paid?: boolean;
}

export interface A2AOrder {
  product: A2AProduct;
  orderId: string;
  amountCny: number;
  method?: 'wechat' | 'alipay' | 'stripe' | 'paypal' | 'local';
  paidAt?: string;
  quantity?: number;
}

export interface A2AComparisonRow {
  no: number;
  name: string;
  origin: string;
  priceCny: number;
  rating: number;
  shipDays: number;
  tags: string;
}

export type A2AAgentReply =
  | { type: 'ask_category'; message: string; chips: string[] }
  | { type: 'results'; message: string; products: A2AProduct[]; comparison: A2AComparisonRow[] }
  | { type: 'empty'; message: string }
  | { type: 'order_prompt'; message: string; product: A2AProduct; products: A2AProduct[] }
  | { type: 'order_created'; message: string; order: A2AOrder }
  | { type: 'paid'; message: string; order: A2AOrder }
  | { type: 'text'; message: string };

const BUY_WORDS = ['买', '下单', '要这个', '来一个', '订购', '拍下', '结算', '选', '锁定', '就要'];

const BUDGET_RE = /(\d{2,6})\s*(?:元|块|￥|rmb|人民币|刀|美元|usd|\$)?/i;

const ORDER_ID_POOL = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function genOrderId(): string {
  let out = 'A2A';
  for (let i = 0; i < 10; i += 1) {
    out += ORDER_ID_POOL[Math.floor(Math.random() * ORDER_ID_POOL.length)];
  }
  return out;
}

export class BuyerAgent {
  private readonly sessions = new Map<string, A2ASessionState>();

  /** 当前生效的商品目录（默认本地 mock；可注入云端目录）。 */
  private products: A2AProduct[];

  constructor(products?: A2AProduct[]) {
    this.products = products && products.length > 0 ? products : PRODUCTS;
  }

  /** 更新商品目录（云端数据到达后调用；检索/比价/下单即时生效）。 */
  setProducts(products: A2AProduct[]): void {
    if (products && products.length > 0) {
      this.products = products;
    }
  }

  private session(sessionId: string): A2ASessionState {
    let st = this.sessions.get(sessionId);
    if (!st) {
      st = { lastProducts: [] };
      this.sessions.set(sessionId, st);
    }
    return st;
  }

  /** 生成一个会话 ID（前端本地用，无需持久化）。 */
  newSessionId(): string {
    return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  handle(message: string, sessionId: string): A2AAgentReply {
    const st = this.session(sessionId);
    const text = (message || '').trim();

    if (!text) {
      return {
        type: 'ask_category',
        message: '您好，我是您的跨境导购 Agent。想买点什么？告诉我品类或具体需求，我帮您找货、比价、下单。',
        chips: Object.keys(CATEGORIES),
      };
    }

    // 1) 选择已展示商品并下单
    if (st.lastProducts.length > 0) {
      const sel = this.extractSelection(text);
      if (sel !== null) {
        if (sel >= 1 && sel <= st.lastProducts.length) {
          const prod = st.lastProducts[sel - 1];
          return {
            type: 'order_prompt',
            message: `已为您锁定「${prod.name}」（¥${prod.price_cny}，${prod.origin}直邮约${prod.ship_days}天）。确认下单？回复「确认」或点下方按钮。`,
            product: prod,
            products: [prod],
          };
        }
        return { type: 'text', message: '没找到对应序号的商品，请重新说一下要第几个～' };
      }
      if (/确认|确定|就它|OK|ok|下单/.test(text)) {
        const prod = st.lastProducts[0];
        return this.createOrder(prod, sessionId);
      }
    }

    // 2) 解析品类 / 预算
    const cat = this.extractCategory(text);
    if (cat) st.category = cat;
    const budget = this.extractBudget(text);
    if (budget !== null) st.budget = budget;

    if (!st.category) {
      return {
        type: 'ask_category',
        message: '想买哪个品类？我可以帮您在海淘好货里比价。',
        chips: Object.keys(CATEGORIES),
      };
    }

    // 3) 检索 + 比价
    const { matches, over } = this.retrieve(text, st.category, st.budget);
    if (matches.length === 0) {
      return { type: 'empty', message: `暂时没找到「${st.category}」相关的跨境商品，换个说法或品类试试？` };
    }
    const top = matches.slice(0, 5);
    st.lastProducts = top;
    const comparison = this.comparison(top);
    const summary = this.summarize(top, st, over);
    return { type: 'results', message: summary, products: top, comparison };
  }

  createOrder(product: A2AProduct, sessionId: string): A2AAgentReply {
    const st = this.session(sessionId);
    const order: A2AOrder = { product, orderId: genOrderId(), amountCny: product.price_cny };
    st.order = order;
    st.paid = false;
    return {
      type: 'order_created',
      message: `已生成订单 ${order.orderId}，金额 ¥${order.amountCny}。请选择支付方式（微信 / 支付宝）。`,
      order,
    };
  }

  pay(method: 'wechat' | 'alipay', sessionId: string): A2AAgentReply {
    const st = this.session(sessionId);
    if (!st.order) return { type: 'text', message: '还没有待支付订单，先选一件商品下单吧。' };
    st.order.method = method;
    st.order.paidAt = new Date().toISOString();
    st.paid = true;
    return { type: 'paid', message: `支付成功（${method === 'wechat' ? '微信' : '支付宝'}）！订单 ${st.order.orderId} 已进入跨境直邮流程。`, order: st.order };
  }

  /** 重置会话（清空品类/预算/候选/订单）。 */
  reset(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  // ── 内部逻辑（对齐调研 agent.py） ──────────────────────────

  private extractCategory(text: string): string | undefined {
    for (const [cat, kws] of Object.entries(CATEGORIES)) {
      if (kws.some((kw) => text.includes(kw))) return cat;
    }
    return undefined;
  }

  private extractBudget(text: string): number | null {
    const m = BUDGET_RE.exec(text);
    if (!m) return null;
    const val = Number.parseInt(m[1], 10);
    const unitHint = /(美元|usd|刀|\$)/i.test(text);
    // 美元按 7.2 汇率折算为人民币
    return unitHint ? Math.round(val * 7.2) : val;
  }

  private extractSelection(text: string): number | null {
    if (!BUY_WORDS.some((w) => text.includes(w))) return null;
    const m = /(?:第\s*)?(\d{1,2})\s*(?:个|件|号)?/.exec(text);
    if (m) return Number.parseInt(m[1], 10);
    return null;
  }

  private retrieve(text: string, category: string, budget?: number): { matches: A2AProduct[]; over: boolean } {
    // 1) 具体品类词优先命中商品标签
    const tagged = this.products.filter((p) => p.tags.some((t) => text.includes(t)));
    const pool = tagged.length > 0 ? tagged : this.products.filter((p) => p.category === category);
    // 2) 预算过滤：仅在预算内有货时才收缩
    let within = pool;
    if (budget !== undefined) {
      const inBudget = pool.filter((p) => p.price_cny <= budget);
      if (inBudget.length > 0) within = inBudget;
    }
    const over = budget !== undefined && pool.every((p) => p.price_cny > budget);
    // 3) 排序：评分降序、价格升序
    const sorted = [...within].sort((a, b) => b.rating - a.rating || a.price_cny - b.price_cny);
    return { matches: sorted, over };
  }

  private comparison(products: A2AProduct[]): A2AComparisonRow[] {
    return products.map((p, i) => ({
      no: i + 1,
      name: p.name,
      origin: p.origin,
      priceCny: p.price_cny,
      rating: p.rating,
      shipDays: p.ship_days,
      tags: p.tags.slice(0, 3).join('、'),
    }));
  }

  private summarize(top: A2AProduct[], st: A2ASessionState, over: boolean): string {
    const cat = st.category ?? '';
    const budget = st.budget;
    let head = `为您找到 ${top.length} 款「${cat}」跨境好物`;
    if (budget !== undefined && !over) head += `（预算 ¥${budget} 内）`;
    head += '，已按评分+性价比排序：';
    const best = top[0];
    let base =
      head + `\n\n推荐首选：#1 ${best.name}（¥${best.price_cny}，${best.origin}直邮约${best.ship_days}天，评分${best.rating}）。回复「买第1个」即可下单。`;
    if (over && budget !== undefined) {
      base += `\n\n⚠️ 这 ${top.length} 款略超您的 ¥${budget} 预算。可回复「提高预算」由我重选，或「找平价」我帮您挑更便宜的替代品。`;
    }
    return base;
  }
}
