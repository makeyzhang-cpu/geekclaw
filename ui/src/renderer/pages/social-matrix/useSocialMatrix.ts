/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCloudAuth } from '@renderer/hooks/context/CloudAuthContext';
import { classifyError, fetchMatrixSnapshot, isDemoMode } from './cloudApi';
import { DEMO_SNAPSHOT } from './demoData';
import type {
  SocialAccount,
  SocialMatrixSnapshot,
  SocialPlatform,
  SocialPlatformMetrics,
  SocialPost,
} from './types';
import { ALL_PLATFORMS } from './platforms';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; source: 'cloud' | 'demo' }
  | { status: 'not-signed-in' }
  | { status: 'cloud-unavailable' };

const EMPTY: SocialMatrixSnapshot = {
  accounts: [],
  posts: [],
  metrics: [],
  configuredPlatforms: [],
};

/**
 * 矩阵数据源。
 *
 * 数据只从云端取（或演示模式下的内置样例），桌面端不做本地持久化——
 * 排期与发布结果的真源必须在服务端，否则换台机器就看不到自己的矩阵。
 */
export function useSocialMatrix() {
  const cloud = useCloudAuth();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [snapshot, setSnapshot] = useState<SocialMatrixSnapshot>(EMPTY);

  const load = useCallback(async () => {
    setState({ status: 'loading' });

    if (isDemoMode()) {
      setSnapshot(DEMO_SNAPSHOT);
      setState({ status: 'ready', source: 'demo' });
      return;
    }

    // 云端账号未登录时不必打接口，直接给出「去登录」引导。
    if (!cloud.state.authenticated) {
      setSnapshot(EMPTY);
      setState({ status: 'not-signed-in' });
      return;
    }

    try {
      const data = await fetchMatrixSnapshot();
      setSnapshot(data);
      setState({ status: 'ready', source: 'cloud' });
    } catch (error) {
      console.warn('[social-matrix] 云端矩阵快照不可用:', error);
      setSnapshot(EMPTY);
      setState(classifyError(error) as LoadState);
    }
  }, [cloud.state.authenticated]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 账号按平台归拢，界面按平台分组渲染。 */
  const accountsByPlatform = useMemo(() => {
    const map = new Map<SocialPlatform, SocialAccount[]>();
    for (const platform of ALL_PLATFORMS) map.set(platform, []);
    for (const account of snapshot.accounts) {
      map.get(account.platform)?.push(account);
    }
    return map;
  }, [snapshot.accounts]);

  /** 已排期（未来要发）的内容，按时间升序——日历与队列都用这一份。 */
  const scheduledPosts = useMemo(
    () =>
      snapshot.posts
        .filter((p) => p.status === 'scheduled' && typeof p.scheduledAt === 'number')
        .sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0)),
    [snapshot.posts]
  );

  /** 已投递过的内容（含部分成功/失败），按发布时间倒序。 */
  const deliveredPosts = useMemo(
    () =>
      snapshot.posts
        .filter((p) => p.status === 'published' || p.status === 'partial' || p.status === 'failed')
        .sort((a, b) => (b.publishedAt ?? b.createdAt) - (a.publishedAt ?? a.createdAt)),
    [snapshot.posts]
  );

  const drafts = useMemo(
    () => snapshot.posts.filter((p) => p.status === 'draft'),
    [snapshot.posts]
  );

  const metricsByPlatform = useMemo(() => aggregateMetrics(snapshot), [snapshot]);

  /** 平台接入状态：服务端已配置 + 本地已连接的账号数。 */
  const platformState = useMemo(
    () =>
      ALL_PLATFORMS.map((platform) => {
        const accounts = accountsByPlatform.get(platform) ?? [];
        const configured = snapshot.configuredPlatforms.includes(platform);
        const needsReauth = accounts.some((a) => a.status !== 'connected');
        return {
          platform,
          configured,
          accountCount: accounts.length,
          connected: accounts.length > 0 && !needsReauth,
          needsReauth,
        };
      }),
    [accountsByPlatform, snapshot.configuredPlatforms]
  );

  return {
    ...state,
    snapshot,
    accountsByPlatform,
    scheduledPosts,
    deliveredPosts,
    drafts,
    metricsByPlatform,
    platformState,
    reload: load,
  };
}

/**
 * 把逐帖指标按平台汇总。
 *
 * ⚠️ 用**每个目标的最新一次采样**参与汇总，不是把历史采样累加——
 * 指标是快照量（累计曝光），定时回收会不断写入新行，直接 sum 会把同一个帖
 * 重复计数。这里按 (accountId, providerPostId) 取 capturedAt 最大的一条。
 */
export function aggregateMetrics(snapshot: SocialMatrixSnapshot): SocialPlatformMetrics[] {
  const latest = new Map<string, (typeof snapshot.metrics)[number]>();
  for (const point of snapshot.metrics) {
    const key = `${point.accountId}::${point.providerPostId}`;
    const prev = latest.get(key);
    if (!prev || point.capturedAt > prev.capturedAt) latest.set(key, point);
  }

  const buckets = new Map<SocialPlatform, SocialPlatformMetrics>();
  for (const platform of ALL_PLATFORMS) {
    buckets.set(platform, {
      platform,
      posts: 0,
      impressions: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      views: 0,
      engagementRate: null,
    });
  }

  for (const point of latest.values()) {
    const bucket = buckets.get(point.platform);
    if (!bucket) continue;
    bucket.posts += 1;
    bucket.impressions += point.impressions ?? 0;
    bucket.likes += point.likes ?? 0;
    bucket.comments += point.comments ?? 0;
    bucket.shares += point.shares ?? 0;
    bucket.views += point.views ?? 0;
  }

  for (const bucket of buckets.values()) {
    bucket.engagementRate =
      bucket.impressions > 0
        ? (bucket.likes + bucket.comments + bucket.shares) / bucket.impressions
        : null;
  }

  return ALL_PLATFORMS.map((p) => buckets.get(p)!);
}

/** 一条内容在界面上显示用的主文案（优先平台版本，回落到主文案）。 */
export function displayText(post: SocialPost): string {
  if (post.text.trim()) return post.text;
  const first = post.versions.find((v) => v.text.trim());
  return first?.text ?? '';
}

/** 统计一条内容的投递结果分布，供列表页展示「4 成功 / 2 失败」。 */
export function deliverySummary(post: SocialPost) {
  let success = 0;
  let failed = 0;
  let pending = 0;
  for (const t of post.targets) {
    if (t.status === 'success') success += 1;
    else if (t.status === 'failed') failed += 1;
    else if (t.status === 'pending') pending += 1;
  }
  return { success, failed, pending, total: post.targets.length };
}
