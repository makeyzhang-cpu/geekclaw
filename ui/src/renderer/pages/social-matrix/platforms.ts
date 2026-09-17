/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SocialPlatform } from './types';

/**
 * 6 个平台的真实能力与约束。
 *
 * ⚠️ 这张表不是设计稿，是把上游源码里的**实际判定逻辑**收敛成前端可用的声明：
 *   - `media: 'required'` / `'video-required'` 对应 Flixty `lib/publish.js` 里
 *     「Instagram requires an image or video」「TikTok requires a video file」
 *     「YouTube requires a video file」这三条硬性前置校验；
 *   - `authVia` 对应「Instagram has no OAuth flow of its own — it's linked
 *     through Facebook」——Instagram 没有独立授权入口，只能由 Facebook 主页
 *     关联的专业账号带入；
 *   - `charLimit` 取各平台当前公开上限（YouTube 是标题 100 / 描述 5000）。
 *
 * 前端据此在「内容创作」里做**发布前把关**：不满足约束的平台直接标红并说明
 * 原因，避免用户在排期队列里堆一批注定失败的帖子。
 */
export type MediaRequirement = 'optional' | 'required' | 'video-required';

export interface PlatformSpec {
  id: SocialPlatform;
  /** 全称，用于界面展示。 */
  label: string;
  /** 短名，用于空间紧张处（日历格子、徽标）。 */
  short: string;
  /** 品牌色（徽标底色 / 图表系列色）。 */
  color: string;
  /** 文案字数上限。 */
  charLimit: number;
  /** 媒体要求。 */
  media: MediaRequirement;
  /** 该平台的账号从哪里授权进来。 */
  authVia: SocialPlatform;
  /** 是否支持发布纯文本。 */
  textOnly: boolean;
  /** 界面上必须让用户知道的限制（来自上游源码的真实备注）。 */
  caveat?: string;
}

export const PLATFORM_SPECS: Record<SocialPlatform, PlatformSpec> = {
  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn',
    short: 'in',
    color: '#0A66C2',
    charLimit: 3000,
    media: 'optional',
    authVia: 'linkedin',
    textOnly: true,
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook',
    short: 'fb',
    color: '#1877F2',
    charLimit: 63206,
    media: 'optional',
    authVia: 'facebook',
    textOnly: true,
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    short: 'ig',
    color: '#E1306C',
    charLimit: 2200,
    media: 'required',
    authVia: 'facebook',
    textOnly: false,
    caveat: '必须带图片或视频；账号需由 Facebook 主页关联的专业账号带入，无法单独授权。',
  },
  youtube: {
    id: 'youtube',
    label: 'YouTube',
    short: 'yt',
    color: '#FF0000',
    charLimit: 5000,
    media: 'video-required',
    authVia: 'youtube',
    textOnly: false,
    caveat: '仅接受视频文件；标题取文案首行并截断到 100 字。',
  },
  x: {
    id: 'x',
    label: 'X',
    short: 'X',
    color: '#0F1419',
    charLimit: 280,
    media: 'optional',
    authVia: 'x',
    textOnly: true,
    caveat: '平台接口发帖需付费套餐，当前通过网页发布通道提交。',
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    short: 'tt',
    color: '#010101',
    charLimit: 2200,
    media: 'video-required',
    authVia: 'tiktok',
    textOnly: false,
    caveat: '仅接受视频文件；未完成应用审核前以私密（仅自己可见）方式发布。',
  },
};

/** 侧栏/表单里稳定的展示顺序（B2B 出海优先）。 */
export const PLATFORM_ORDER: SocialPlatform[] = [
  'linkedin',
  'facebook',
  'instagram',
  'youtube',
  'x',
  'tiktok',
];

export const ALL_PLATFORMS = PLATFORM_ORDER;

export function platformSpec(platform: SocialPlatform): PlatformSpec {
  return PLATFORM_SPECS[platform];
}

export function platformLabel(platform: SocialPlatform): string {
  return PLATFORM_SPECS[platform]?.label ?? platform;
}

/** 发布前置校验结果。 */
export interface PlatformCheckResult {
  ok: boolean;
  /** 不通过的原因（直接展示给用户）。 */
  reason?: string;
  /** 警告级问题：能发，但需要用户知情。 */
  warning?: string;
}

/**
 * 发布前校验：某平台的这份文案 + 媒体能否发出去。
 *
 * ⚠️ 与上游保持一致的一点：**媒体类型判定按 `mimeType` 前缀**，不是按文件后缀
 * ——Flixty 里也是 `media.mimeType?.startsWith('video/')`，因为有些平台会对
 * 改名的文件返回类型不符错误，按声明的 MIME 判定能提前拦住。
 */
export function checkForPlatform(
  platform: SocialPlatform,
  text: string,
  mediaTypes: string[]
): PlatformCheckResult {
  const spec = PLATFORM_SPECS[platform];
  if (!spec) return { ok: false, reason: '未知平台' };

  const trimmed = text.trim();
  const hasMedia = mediaTypes.length > 0;
  const hasVideo = mediaTypes.some((m) => m.startsWith('video/'));

  if (!trimmed && !hasMedia) {
    return { ok: false, reason: '文案与媒体不能都为空' };
  }

  if (spec.media === 'required' && !hasMedia) {
    return { ok: false, reason: `${spec.label} 必须带图片或视频` };
  }

  if (spec.media === 'video-required' && !hasVideo) {
    return {
      ok: false,
      reason: hasMedia ? `${spec.label} 只接受视频文件` : `${spec.label} 必须带视频文件`,
    };
  }

  if (!spec.textOnly && !hasMedia) {
    return { ok: false, reason: `${spec.label} 不支持纯文本发布` };
  }

  if (trimmed.length > spec.charLimit) {
    return {
      ok: false,
      reason: `超出 ${spec.charLimit} 字上限（当前 ${trimmed.length} 字）`,
    };
  }

  // 能发但有平台侧的限制需要用户知情。
  if (spec.caveat && (spec.id === 'tiktok' || spec.id === 'x')) {
    return { ok: true, warning: spec.caveat };
  }

  return { ok: true };
}

/** 按平台字数上限生成「剩余字数」进度信息。 */
export function charBudget(platform: SocialPlatform, text: string) {
  const limit = PLATFORM_SPECS[platform].charLimit;
  const used = text.trim().length;
  const ratio = limit > 0 ? used / limit : 0;
  return {
    used,
    limit,
    remaining: limit - used,
    /** 0–1，用于进度条宽度。 */
    ratio: Math.min(ratio, 1),
    /** 超出上限。 */
    over: used > limit,
  };
}
