/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 专家数字分身市场 REST 客户端。
 *
 * 与 `nomifun-app` 的 `expert_market_routes` 对接（`/api/experts/*`），
 * 复用共享的 `httpBridge`（`getBaseUrl` + `{ success, data }` 信封解包）。
 */

import { httpRequest } from '@/common/adapter/httpBridge';

export type ExpertScope = 'all' | 'builtin';

export interface ExpertSummary {
  expert_id: string;
  slug: string;
  name: string;
  title: string;
  description: string | null;
  avatar: string | null;
  tags: string[];
  category: string | null;
  price_credits: number;
  is_owned: boolean;
}

export interface ExpertSyncResult {
  synced: number;
  pruned: number;
  total_local: number;
}

export interface ExpertDetail {
  expert_id: string;
  slug: string;
  name: string;
  title: string;
  description: string | null;
  avatar: string | null;
  tags: string[];
  category: string | null;
  price_credits: number;
  persona_custom: string;
  persona_preset: string;
  default_character: string;
  default_model: string | null;
  default_model_provider: string | null;
  default_skills: string[];
  is_owned: boolean;
}

export interface HireResponse {
  expert_id: string;
  license_id: string;
  companion_id: string;
  balance: number;
  already_owned: boolean;
}

export interface MyExpert {
  expert_id: string;
  slug: string;
  name: string;
  title: string;
  avatar: string | null;
  category: string | null;
  companion_ref: string;
  purchased_at: number;
}

function buildQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    sp.append(key, value);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** 市场列表（可按分类 / 关键词 / 范围过滤）。 */
export async function listExperts(
  category?: string,
  q?: string,
  scope?: ExpertScope
): Promise<ExpertSummary[]> {
  const res = await httpRequest<ExpertSummary[]>(
    'GET',
    `/api/experts${buildQuery({ category, q, scope })}`
  );
  return res ?? [];
}

/** 专家详情（id = slug 或 expert_id）。 */
export async function getExpert(id: string): Promise<ExpertDetail> {
  return httpRequest<ExpertDetail>('GET', `/api/experts/${encodeURIComponent(id)}`);
}

/** 雇佣专家 → 创建数字分身 Companion 并（按需）扣积分。 */
export async function hireExpert(id: string): Promise<HireResponse> {
  return httpRequest<HireResponse>('POST', `/api/experts/${encodeURIComponent(id)}/hire`);
}

/** 我雇佣的专家（含可跳转的数字分身引用）。 */
export async function myExperts(): Promise<MyExpert[]> {
  const res = await httpRequest<MyExpert[]>('GET', '/api/experts/mine');
  return res ?? [];
}

/** 从云端管理后台同步专家目录到本地（桌面端消费入口）。 */
export async function syncExperts(): Promise<ExpertSyncResult> {
  return httpRequest<ExpertSyncResult>('POST', '/api/experts/sync');
}
