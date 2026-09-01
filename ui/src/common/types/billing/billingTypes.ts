// 经济闭环前端类型 —— 对齐后端 nomifun-api-types 的计费 DTO。
// 后端 /api/billing/* 与 /api/auth/users/:id/plan 返回的结构。

export type PlanTier = 'free' | 'pro' | 'team';

/** 单条积分账本记录（credit_transactions 表）。 */
export interface CreditTransactionInfo {
  id: number;
  user_id: string;
  /** 交易类型：signup_bonus | invite_reward | adjust | consume | ... */
  tx_type: string;
  /** 变动量：正=入账，负=扣减。 */
  amount: number;
  /** 变动后余额。 */
  balance_after: number;
  ref_type?: string | null;
  ref_value?: string | null;
  note?: string | null;
  /** epoch 毫秒。 */
  created_at: number;
}

/** 当前用户钱包 + 账本（GET /api/billing/me）。 */
export interface BillingBalance {
  success: boolean;
  user_id: string;
  plan: string;
  credits: number;
  transactions: CreditTransactionInfo[];
}

/** 模型价格（model_pricing 表）。 */
export interface ModelPriceInfo {
  id: number;
  provider: string;
  model: string;
  task: string;
  input_credits_per_1k: number;
  output_credits_per_1k: number;
  cache_read_credits_per_1k: number;
  currency: string;
  updated_at: number;
}

export interface ModelPriceListResponse {
  success: boolean;
  prices: ModelPriceInfo[];
}

/** POST /api/billing/users/:id/adjust 请求体。 */
export interface AdjustCreditsRequest {
  delta: number;
  note?: string | null;
}

/** POST /api/auth/users/:id/plan 请求体。 */
export interface SetPlanRequest {
  plan: string;
}

/** PUT /api/billing/pricing 请求体。 */
export interface UpsertPricingRequest {
  provider: string;
  model: string;
  task: string;
  input_credits_per_1k: number;
  output_credits_per_1k: number;
  cache_read_credits_per_1k: number;
  currency?: string | null;
}

/** 用户列表项（GET /api/auth/users，含套餐/积分）。 */
export interface UserListItem {
  user_id: string;
  username: string;
  role: string;
  is_active: boolean;
  last_login?: number | null;
  plan: string;
  credits: number;
}

export interface ListUsersResponse {
  success: boolean;
  users: UserListItem[];
}

/** POST /api/billing/subscribe 响应：收银二维码 + 订单号。 */
export interface SubscribeResponse {
  success: boolean;
  message?: string;
  data?: {
    reqsn: string;
    amount_fen: number;
    plan: string;
    period: string;
    payinfo: Record<string, string>;
  };
  error?: string;
}

/** GET /api/billing/order/{reqsn} 响应：订单支付状态。 */
export interface OrderStatusResponse {
  success: boolean;
  data?: {
    reqsn: string;
    status: string;
    plan: string;
    period: string;
    amount_fen: number;
    qr_payinfo?: string | null;
  };
  error?: string;
}

/** POST /api/billing/subscribe 请求体。 */
export interface SubscribeRequest {
  plan_id: string;
  period?: string;
}
