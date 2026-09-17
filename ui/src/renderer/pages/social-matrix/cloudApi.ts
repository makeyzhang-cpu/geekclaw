/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 海外社媒矩阵 — 云端数据源适配层。
 *
 * 架构约定：
 *   - 社交引擎（OAuth 授权、排期、发布、指标回收）常驻云端，桌面端不持有任何
 *     平台密钥，也不参与发布；
 *   - 桌面端只经本地后端代理读写云端（`/api/store/social/*` → 云端
 *     `/api/social/*`，带云端 JWT），与押金（`/api/store/hardware/*`）同一套模式；
 *   - 这样做的**决定性理由**：排期帖必须由服务端发出，用户关机也要按时投递；
 *     OAuth 回调也必须是公网可达的固定地址。
 *
 * **发布通道缺失是一等状态，不是异常**：服务端还没接入某个平台的投递通道时
 * （首期为聚合商 API Key 未配置），云端会在 `configuredPlatforms` 里如实上报，
 * 界面显示「待接入」而不是报错。配置好之后它会自动转为「未连接」。
 *
 * 本地演示模式（仅开发/演示用）：
 *   localStorage.setItem('social:demo-mode', '1') → 走内置样例数据。
 */

import { httpRequest } from '@/common/adapter/httpBridge';
import type {
  SocialAccount,
  SocialMatrixSnapshot,
  SocialMetricPoint,
  SocialPlatform,
  SocialPost,
  SocialPostTargetResult,
  SocialPostVersion,
  SocialCloudState,
} from './types';
import { ALL_PLATFORMS } from './platforms';

const DEMO_MODE_KEY = 'social:demo-mode';

export function isDemoMode(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DEMO_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDemoMode(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(DEMO_MODE_KEY, '1');
    else localStorage.removeItem(DEMO_MODE_KEY);
  } catch {
    /* localStorage 不可用：忽略，演示开关尽力而为 */
  }
}

/* ------------------------------------------------------------------ *
 * 云端响应类型（字段名以云端为准，宽松解析，缺字段一律给安全默认）
 * ------------------------------------------------------------------ */

interface CloudMatrixResponse {
  success?: boolean;
  accounts?: unknown[];
  posts?: unknown[];
  metrics?: unknown[];
  configured_platforms?: unknown[];
}

interface CloudConnectResponse {
  success?: boolean;
  /** 平台授权页地址，桌面端用系统浏览器打开。 */
  auth_url?: string;
  error?: string;
}

interface CloudPostResponse {
  success?: boolean;
  post?: unknown;
  error?: string;
}

/* ------------------------------------------------------------------ *
 * 宽松解析：云端字段可能是 snake_case，也可能缺字段；一律归一化后再进 UI，
 * 让界面代码不必到处写 `?? 0`。
 * ------------------------------------------------------------------ */

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

const asNumber = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
};

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

const isPlatform = (v: unknown): v is SocialPlatform =>
  typeof v === 'string' && (ALL_PLATFORMS as string[]).includes(v);

function parseAccount(raw: unknown): SocialAccount | null {
  const r = asRecord(raw);
  const id = asString(r.id);
  const platform = r.platform;
  if (!id || !isPlatform(platform)) return null;

  const statusRaw = asString(r.status);
  const status: SocialAccount['status'] =
    statusRaw === 'expired' || statusRaw === 'error' || statusRaw === 'revoked'
      ? statusRaw
      : 'connected';

  return {
    id,
    platform,
    name: asString(r.name) ?? asString(r.handle) ?? id,
    handle: asString(r.handle),
    avatarUrl: asString(r.avatar_url) ?? asString(r.avatarUrl),
    status,
    expiresAt: asNumber(r.expires_at) ?? asNumber(r.expiresAt),
    connectedAt: asNumber(r.connected_at) ?? asNumber(r.connectedAt),
    targets: asArray(r.targets)
      .map((t) => {
        const tr = asRecord(t);
        const tid = asString(tr.id);
        if (!tid) return null;
        return {
          id: tid,
          name: asString(tr.name) ?? tid,
          kind: asString(tr.kind) as never,
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null),
    error: asString(r.error),
  };
}

function parseVersions(raw: unknown): SocialPostVersion[] {
  return asArray(raw)
    .map((v): SocialPostVersion | null => {
      const vr = asRecord(v);
      if (!isPlatform(vr.platform)) return null;
      return {
        platform: vr.platform,
        text: typeof vr.text === 'string' ? vr.text : '',
        targetIds: asArray(vr.target_ids ?? vr.targetIds).filter(
          (x): x is string => typeof x === 'string'
        ),
      };
    })
    .filter((v): v is SocialPostVersion => v !== null);
}

function parsePost(raw: unknown): SocialPost | null {
  const r = asRecord(raw);
  const id = asString(r.id);
  if (!id) return null;

  const statusRaw = asString(r.status);
  const status: SocialPost['status'] =
    statusRaw === 'scheduled' ||
    statusRaw === 'publishing' ||
    statusRaw === 'published' ||
    statusRaw === 'partial' ||
    statusRaw === 'failed'
      ? statusRaw
      : 'draft';

  return {
    id,
    status,
    text: typeof r.text === 'string' ? r.text : '',
    media: asArray(r.media)
      .map((m) => {
        const mr = asRecord(m);
        const url = asString(mr.url);
        if (!url) return null;
        return {
          id: asString(mr.id) ?? url,
          url,
          mimeType: asString(mr.mime_type) ?? asString(mr.mimeType) ?? 'application/octet-stream',
          name: asString(mr.name),
          size: asNumber(mr.size),
          width: asNumber(mr.width),
          height: asNumber(mr.height),
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null),
    versions: parseVersions(r.versions),
    targets: asArray(r.targets)
      .map((t): SocialPostTargetResult | null => {
        const tr = asRecord(t);
        const accountId = asString(tr.account_id) ?? asString(tr.accountId);
        if (!accountId || !isPlatform(tr.platform)) return null;
        const st = asString(tr.status);
        const status: SocialPostTargetResult['status'] =
          st === 'success' || st === 'failed' || st === 'skipped' ? st : 'pending';
        return {
          accountId,
          platform: tr.platform,
          targetId: asString(tr.target_id) ?? asString(tr.targetId),
          targetName: asString(tr.target_name) ?? asString(tr.targetName),
          status,
          providerPostId: asString(tr.provider_post_id) ?? asString(tr.providerPostId),
          permalink: asString(tr.permalink),
          error: asString(tr.error),
          publishedAt: asNumber(tr.published_at) ?? asNumber(tr.publishedAt),
        };
      })
      .filter((t): t is SocialPostTargetResult => t !== null),
    scheduledAt: asNumber(r.scheduled_at) ?? asNumber(r.scheduledAt),
    publishedAt: asNumber(r.published_at) ?? asNumber(r.publishedAt),
    createdAt: asNumber(r.created_at) ?? asNumber(r.createdAt) ?? Date.now(),
    campaign: asString(r.campaign),
    tags: asArray(r.tags).filter((x): x is string => typeof x === 'string'),
  };
}

function parseMetric(raw: unknown): SocialMetricPoint | null {
  const r = asRecord(raw);
  const accountId = asString(r.account_id) ?? asString(r.accountId);
  const providerPostId = asString(r.provider_post_id) ?? asString(r.providerPostId);
  if (!accountId || !providerPostId || !isPlatform(r.platform)) return null;
  return {
    accountId,
    platform: r.platform,
    providerPostId,
    capturedAt: asNumber(r.captured_at) ?? asNumber(r.capturedAt) ?? Date.now(),
    impressions: asNumber(r.impressions),
    likes: asNumber(r.likes),
    comments: asNumber(r.comments),
    shares: asNumber(r.shares),
    views: asNumber(r.views),
    saves: asNumber(r.saves),
    clicks: asNumber(r.clicks),
  };
}

/* ------------------------------------------------------------------ *
 * 错误分类：把「没登录」「云端没部署这接口」「平台没配密钥」区分开，
 * 因为三者在界面上要给完全不同的引导。
 * ------------------------------------------------------------------ */

export function classifyError(error: unknown): SocialCloudState {
  const status = (error as { status?: number })?.status;
  if (status === 401 || status === 403) return { status: 'not-signed-in' };
  return { status: 'cloud-unavailable' };
}

export function errorStatus(error: unknown): number | undefined {
  return (error as { status?: number })?.status;
}

/* ------------------------------------------------------------------ *
 * 接口
 * ------------------------------------------------------------------ */

/**
 * 拉取矩阵总览：账号 + 内容 + 指标 + 服务端已配置的平台。
 *
 * 分开拉会往返 3 次且可能互相不一致（例如刚发布的帖子还没进指标），
 * 云端按一次性快照返回，前端一次渲染。
 */
export async function fetchMatrixSnapshot(): Promise<SocialMatrixSnapshot> {
  const resp = await httpRequest<CloudMatrixResponse>('GET', '/api/store/social/matrix');
  const configured = asArray(resp?.configured_platforms)
    .filter(isPlatform)
    .slice();
  return {
    accounts: asArray(resp?.accounts)
      .map(parseAccount)
      .filter((a): a is SocialAccount => a !== null),
    posts: asArray(resp?.posts)
      .map(parsePost)
      .filter((p): p is SocialPost => p !== null),
    metrics: asArray(resp?.metrics)
      .map(parseMetric)
      .filter((m): m is SocialMetricPoint => m !== null),
    configuredPlatforms: configured,
  };
}

/**
 * 取某平台的授权入口地址。
 *
 * 由服务端生成授权的 state / PKCE，前端只负责把用户带到平台页面上。
 */
export async function requestAuthUrl(platform: SocialPlatform): Promise<string> {
  const resp = await httpRequest<CloudConnectResponse>(
    'POST',
    `/api/store/social/accounts/${platform}/connect`
  );
  const url = resp?.auth_url;
  if (!url) throw new Error(resp?.error ?? '服务端未返回授权地址');
  return url;
}

/** 断开一个账号（服务端同时吊销平台侧 token）。 */
export async function disconnectAccount(accountId: string): Promise<void> {
  await httpRequest('DELETE', `/api/store/social/accounts/${encodeURIComponent(accountId)}`);
}

/** 新建内容：可立即发布、定时排期，或仅存草稿。 */
export async function createPost(input: {
  text: string;
  versions: SocialPostVersion[];
  /** 目标账号（账号 id + 可选子目标 id）。 */
  targets: { accountId: string; targetId?: string }[];
  mediaIds?: string[];
  scheduledAt?: number;
  campaign?: string;
  tags?: string[];
  /** true = 不排期，立刻投递。 */
  publishNow?: boolean;
}): Promise<SocialPost> {
  const resp = await httpRequest<CloudPostResponse>('POST', '/api/store/social/posts', {
    text: input.text,
    versions: input.versions.map((v) => ({
      platform: v.platform,
      text: v.text,
      target_ids: v.targetIds ?? [],
    })),
    targets: input.targets.map((t) => ({
      account_id: t.accountId,
      target_id: t.targetId ?? null,
    })),
    media_ids: input.mediaIds ?? [],
    scheduled_at: input.scheduledAt ?? null,
    campaign: input.campaign ?? null,
    tags: input.tags ?? [],
    publish_now: input.publishNow === true,
  });
  const post = parsePost(resp?.post);
  if (!post) throw new Error(resp?.error ?? '服务端未返回创建结果');
  return post;
}

/** 立即发布一条已存在的草稿/排期帖。 */
export async function publishPostNow(postId: string): Promise<SocialPost> {
  const resp = await httpRequest<CloudPostResponse>(
    'POST',
    `/api/store/social/posts/${encodeURIComponent(postId)}/publish`
  );
  const post = parsePost(resp?.post);
  if (!post) throw new Error(resp?.error ?? '服务端未返回发布结果');
  return post;
}

/** 撤销排期（回到草稿，不删除内容）。 */
export async function cancelSchedule(postId: string): Promise<void> {
  await httpRequest('POST', `/api/store/social/posts/${encodeURIComponent(postId)}/cancel`);
}

/** 删除一条内容及其排期。 */
export async function deletePost(postId: string): Promise<void> {
  await httpRequest('DELETE', `/api/store/social/posts/${encodeURIComponent(postId)}`);
}
