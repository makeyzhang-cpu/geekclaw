/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 海外社媒矩阵工作台 — 领域模型。
 *
 * 模型取自两条上游源码的优势结合：
 *
 * 1) 结构（来自 Mixpost，成熟社媒管理产品的域模型）——
 *    - `SocialPost` ≈ `mixpost_posts`：一条内容为主体，带 status / scheduled_at /
 *      published_at；
 *    - `SocialPostVersion` ≈ `mixpost_post_versions`：**按平台差异化改写的文案**，
 *      这是「一稿多投」的关键——同一条内容在 X 要短、在 LinkedIn 要正式、
 *      在 Instagram 要配图说明；
 *    - `SocialPostTargetResult` ≈ `mixpost_post_accounts` 中间表：**逐平台独立**
 *      记录 `errors` 与 `provider_post_id`。一条内容投 6 个平台，允许 4 个成功
 *      2 个失败，失败原因各自保留，不整条回滚；
 *    - `SocialMetricPoint` ≈ `mixpost_metrics`：发布后按目标回收互动数据。
 *
 * 2) 能力面（来自 Flixty）——6 个平台的差异化约束（是否必须带媒体、字数上限、
 *    沙箱限制）集中声明在 `platforms.ts`，发布前统一由 `validateForPlatform` 把关。
 */

/** 已接入的 6 个海外社媒平台。 */
export type SocialPlatform = 'linkedin' | 'facebook' | 'instagram' | 'youtube' | 'x' | 'tiktok';

/** 账号授权状态。 */
export type SocialAccountStatus = 'connected' | 'expired' | 'error' | 'revoked';

/** 内容生命周期状态（对齐 mixpost PostStatus）。 */
export type SocialPostStatus =
  | 'draft'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'partial'
  | 'failed';

/** 单目标发布结果（对齐 mixpost post_accounts 中间表）。 */
export type SocialDeliveryStatus = 'pending' | 'success' | 'failed' | 'skipped';

/** 某平台下可选中的发布目标（个人号 / 公司主页 / 频道 / 业务主页）。 */
export interface SocialAccountTarget {
  /** 平台侧目标 id（LinkedIn urn / Facebook page id / YouTube channel id …）。 */
  id: string;
  /** 展示名。 */
  name: string;
  /** 目标类型，仅用于 UI 上的标签展示。 */
  kind?: 'person' | 'organization' | 'page' | 'channel' | 'business';
}

/** 矩阵里的一个账号（对齐 mixpost_accounts）。 */
export interface SocialAccount {
  id: string;
  platform: SocialPlatform;
  /** 账号展示名。 */
  name: string;
  /** @handle，可能没有（如 Facebook 主页）。 */
  handle?: string;
  avatarUrl?: string;
  status: SocialAccountStatus;
  /** 授权过期时间（毫秒时间戳）。 */
  expiresAt?: number;
  connectedAt?: number;
  /** 可发布的子目标；为空表示账号本身即发布目标。 */
  targets?: SocialAccountTarget[];
  /** 校验失败 / 授权失败时的原因。 */
  error?: string;
}

/** 媒体附件（对齐 mixpost_media）。 */
export interface SocialMedia {
  id: string;
  url: string;
  mimeType: string;
  name?: string;
  size?: number;
  width?: number;
  height?: number;
}

/** 平台差异化版本（对齐 mixpost_post_versions）。 */
export interface SocialPostVersion {
  platform: SocialPlatform;
  /** 该平台专属文案；为空表示回落到主文案。 */
  text: string;
  /** 该平台要投递到的目标 id 列表；为空表示投到该平台全部已连接目标。 */
  targetIds?: string[];
}

/** 逐目标发布结果（对齐 mixpost post_accounts）。 */
export interface SocialPostTargetResult {
  accountId: string;
  platform: SocialPlatform;
  targetId?: string;
  targetName?: string;
  status: SocialDeliveryStatus;
  /** 平台返回的帖子 id，用于后续回收指标。 */
  providerPostId?: string;
  /** 平台帖子地址，便于跳转核对。 */
  permalink?: string;
  /** 失败原因（平台原文，不翻译，方便直接排查）。 */
  error?: string;
  publishedAt?: number;
}

/** 一条内容（对齐 mixpost_posts）。 */
export interface SocialPost {
  id: string;
  status: SocialPostStatus;
  /** 主文案：所有未单独改写的平台都发这段。 */
  text: string;
  media?: SocialMedia[];
  /** 平台差异化版本。 */
  versions: SocialPostVersion[];
  /** 逐目标结果。 */
  targets: SocialPostTargetResult[];
  scheduledAt?: number;
  publishedAt?: number;
  createdAt: number;
  /** 活动/系列名，便于按 campaign 归拢。 */
  campaign?: string;
  tags?: string[];
}

/** 指标采样点（对齐 mixpost_metrics）。 */
export interface SocialMetricPoint {
  accountId: string;
  platform: SocialPlatform;
  providerPostId: string;
  capturedAt: number;
  impressions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  saves?: number;
  clicks?: number;
}

/** 按平台聚合后的指标（看板用）。 */
export interface SocialPlatformMetrics {
  platform: SocialPlatform;
  posts: number;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  /** 互动率 =（likes + comments + shares）/ impressions，无曝光时为 null。 */
  engagementRate: number | null;
}

/** 云端社媒接口整体可用性。 */
export type SocialCloudState =
  | { status: 'ready' }
  | { status: 'not-signed-in' }
  | { status: 'platform-not-configured'; missing: SocialPlatform[] }
  | { status: 'cloud-unavailable' };

/** 云端返回的矩阵总览（一次拉齐，减少往返）。 */
export interface SocialMatrixSnapshot {
  accounts: SocialAccount[];
  posts: SocialPost[];
  metrics: SocialMetricPoint[];
  /**
   * 服务端**已可真实投递**的平台（首期 = 配好聚合商 API Key 后的 5 个平台，
   * 刻意不含 X）。其余平台在 UI 上标记「待接入」；半自动模式下这里是空集。
   */
  configuredPlatforms: SocialPlatform[];
}
