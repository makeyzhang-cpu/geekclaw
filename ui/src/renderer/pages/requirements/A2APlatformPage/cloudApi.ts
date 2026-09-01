/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A2A 跨境电商 — 云端数据源适配层。
 *
 * 架构约定（2026-08-21 用户明确）：
 *   - A2A 跨境电商平台的管理总后台 = 网页端管理后台（geekclaw.ai/admin），
 *     商品/订单/商家数据真源在云端；
 *   - A2A 跨境电商独立站的开通授权 = 网页端管理后台授权，授权后用户才能使用。
 *
 * 桌面端经本地后端代理读取云端（`/api/store/a2a/*`，webview 直连云端无 CORS）。
 * 云端接口未就绪（502/404/超时）时优雅降级：
 *   - 平台商品：降级本地 mock 商品库（catalog.ts），UI 标注「本地演示模式」；
 *   - 独立站授权：云端不可用 → 显示「云端未配置」+ 本地演示开关，不假装已授权。
 *
 * 本地演示模式开关（仅开发/演示用，正式版应移除）：
 *   localStorage.setItem('a2a:demo-mode', '1')  → 强制使用本地数据/本地授权。
 */

import { httpRequest } from '@/common/adapter/httpBridge';
import type { A2AProduct } from './catalog';
import { PRODUCTS } from './catalog';

/** 云端商品目录响应（结构由云端管理后台约定，字段名以云端为准，宽松解析）。 */
export interface CloudA2AProduct {
  id?: string;
  name?: string;
  category?: string;
  origin?: string;
  price_cny?: number;
  rating?: number;
  ship_days?: number;
  stock?: number;
  tags?: string[];
}

export interface CloudA2AProductsResponse {
  success?: boolean;
  products?: CloudA2AProduct[];
}

/** 云端独立站开通授权状态（结构由云端管理后台约定，宽松解析）。 */
export interface CloudA2AStorefrontStatus {
  /** 是否已由网页端管理后台授权开通。 */
  enabled?: boolean;
  /** 授权商户名 / 独立站名（可空）。 */
  merchant?: string;
  /** 授权到期时间（毫秒时间戳，可空=长期）。 */
  expires_at?: number;
}

export type StorefrontAccessState =
  | { status: 'authorized'; merchant?: string; expiresAt?: number }
  | { status: 'unauthorized' }
  | { status: 'cloud-unavailable' }
  | { status: 'not-signed-in' };

const DEMO_MODE_KEY = 'a2a:demo-mode';

export function isDemoMode(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DEMO_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

function toLocalProduct(c: CloudA2AProduct, index: number): A2AProduct {
  return {
    id: c.id ?? `cloud-${index}`,
    name: c.name ?? '未命名商品',
    category: c.category ?? '其他',
    origin: c.origin ?? '未知',
    price_cny: c.price_cny ?? 0,
    rating: c.rating ?? 4.5,
    ship_days: c.ship_days ?? 7,
    stock: c.stock ?? 0,
    tags: Array.isArray(c.tags) ? c.tags : [],
  };
}

/**
 * 读取 A2A 商品目录：云端优先（网页端管理后台真源），失败降级本地 mock。
 *
 * @returns `{ source: 'cloud', products }` 或 `{ source: 'local', products }`。
 *   UI 可根据 `source` 显示「云端数据」/「本地演示」角标。
 */
export async function loadA2AProducts(): Promise<{ source: 'cloud' | 'local'; products: A2AProduct[] }> {
  // 本地演示模式：跳过云端直连。
  if (isDemoMode()) {
    return { source: 'local', products: PRODUCTS };
  }
  try {
    const resp = await httpRequest<CloudA2AProductsResponse>('GET', '/api/store/a2a/products');
    const list = resp?.products;
    if (Array.isArray(list) && list.length > 0) {
      const products = list.map(toLocalProduct);
      return { source: 'cloud', products };
    }
    // 云端返回空目录 → 也降级本地（云端可能刚初始化）。
    return { source: 'local', products: PRODUCTS };
  } catch (error) {
    console.warn('[a2a] 云端商品目录不可用，降级本地演示:', error);
    return { source: 'local', products: PRODUCTS };
  }
}

/**
 * 查询 A2A 独立站开通授权状态（网页端管理后台授权）。
 *
 * - 云端已授权 → `authorized`
 * - 云端明确未授权 → `unauthorized`
 * - 云端接口不可用（未实现/超时）→ `cloud-unavailable`（前端显示开通引导，不假装可用）
 * - 未登录云端账号 → `not-signed-in`（提示先登录）
 *
 * 本地演示模式：返回 `authorized`（仅开发/演示用）。
 */
export async function loadStorefrontAccess(): Promise<StorefrontAccessState> {
  if (isDemoMode()) {
    return { status: 'authorized', merchant: '演示商家' };
  }
  try {
    const resp = await httpRequest<CloudA2AStorefrontStatus>('GET', '/api/store/a2a/storefront/status');
    if (resp && resp.enabled) {
      return { status: 'authorized', merchant: resp.merchant, expiresAt: resp.expires_at };
    }
    return { status: 'unauthorized' };
  } catch (error) {
    // 401 → 未登录云端；其余（502/404/网络）→ 云端接口未就绪。
    const status = (error as { status?: number })?.status;
    if (status === 401) {
      return { status: 'not-signed-in' };
    }
    console.warn('[a2a] 云端独立站授权状态不可用:', error);
    return { status: 'cloud-unavailable' };
  }
}
