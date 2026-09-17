/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 演示数据（仅当 `localStorage['social:demo-mode'] === '1'` 时启用）。
 *
 * 用途有两个，都很实际：
 *   1. 平台开发者应用还没申请下来时，团队能先看到完整工作台的形态与交互；
 *   2. 联调阶段云端接口挂掉时，界面不至于是一片空白，便于定位是前端问题
 *      还是云端问题。
 *
 * ⚠️ 这些数据**只在前端内存中存在**，不会写回云端，也不参与真实发布。
 * 界面上会明确打「演示数据」角标，避免与真实矩阵混淆。
 */

import type { SocialMatrixSnapshot } from './types';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const now = Date.now();

export const DEMO_SNAPSHOT: SocialMatrixSnapshot = {
  // 只连了两个平台，其余四个在界面上呈现「待接入」——这正是真实起步状态。
  configuredPlatforms: ['linkedin', 'facebook'],
  accounts: [
    {
      id: 'demo-li-person',
      platform: 'linkedin',
      name: 'Zhang Junbo',
      handle: 'zhangjunbo',
      status: 'connected',
      connectedAt: now - 12 * DAY,
      expiresAt: now + 48 * DAY,
      targets: [
        { id: 'urn:li:person:demo', name: 'Zhang Junbo（个人）', kind: 'person' },
        {
          id: 'urn:li:organization:9001',
          name: 'Guangdong Geek Marketing',
          kind: 'organization',
        },
      ],
    },
    {
      id: 'demo-fb-page',
      platform: 'facebook',
      name: 'GeekClaw Global',
      status: 'connected',
      connectedAt: now - 9 * DAY,
      expiresAt: now + 51 * DAY,
      targets: [{ id: 'page_7788', name: 'GeekClaw Global', kind: 'page' }],
    },
  ],
  posts: [
    {
      id: 'demo-post-1',
      status: 'published',
      text: 'Most export teams lose deals not on price, but on response time.\n\nWe mapped 1,200 inbound inquiries across 40 factories — the median first reply took 19 hours. The winners replied in under 2.\n\nSpeed is the cheapest differentiator in cross-border trade.',
      createdAt: now - 6 * DAY,
      publishedAt: now - 5 * DAY,
      campaign: 'Speed Wins',
      tags: ['lead-response', 'ops'],
      media: [],
      versions: [
        {
          platform: 'linkedin',
          text: 'Most export teams lose deals not on price, but on response time.\n\nWe mapped 1,200 inbound inquiries across 40 factories — the median first reply took 19 hours. The winners replied in under 2.\n\nSpeed is the cheapest differentiator in cross-border trade.',
        },
        {
          platform: 'facebook',
          text: '19 hours vs 2 hours. That gap is where deals are won and lost.\n\nWe mapped 1,200 export inquiries — here is what the data says about response time. 👇',
        },
      ],
      targets: [
        {
          accountId: 'demo-li-person',
          platform: 'linkedin',
          targetId: 'urn:li:person:demo',
          targetName: 'Zhang Junbo（个人）',
          status: 'success',
          providerPostId: 'li_8812334',
          permalink: 'https://www.linkedin.com/feed/update/urn:li:share:demo1',
          publishedAt: now - 5 * DAY,
        },
        {
          accountId: 'demo-fb-page',
          platform: 'facebook',
          targetId: 'page_7788',
          targetName: 'GeekClaw Global',
          status: 'success',
          providerPostId: 'fb_778121',
          permalink: 'https://www.facebook.com/demo/posts/778121',
          publishedAt: now - 5 * DAY,
        },
      ],
    },
    {
      id: 'demo-post-2',
      status: 'partial',
      text: 'New teardown: how a 12-person Ningbo factory runs 40 export SKUs without a single spreadsheet.\n\nFull breakdown in the comments.',
      createdAt: now - 3 * DAY,
      publishedAt: now - 3 * DAY,
      campaign: 'Factory Ops',
      media: [
        {
          id: 'demo-media-1',
          url: '/demo/social/factory-floor.jpg',
          mimeType: 'image/jpeg',
          name: 'factory-floor.jpg',
          width: 1600,
          height: 900,
        },
      ],
      versions: [],
      targets: [
        {
          accountId: 'demo-li-person',
          platform: 'linkedin',
          targetId: 'urn:li:person:demo',
          targetName: 'Zhang Junbo（个人）',
          status: 'success',
          providerPostId: 'li_8819902',
          publishedAt: now - 3 * DAY,
        },
        {
          accountId: 'demo-fb-page',
          platform: 'facebook',
          targetId: 'page_7788',
          targetName: 'GeekClaw Global',
          status: 'failed',
          error:
            '#200 (#200) The user hasn\'t authorized application 1234 to publish to this Page.',
          publishedAt: now - 3 * DAY,
        },
      ],
    },
    {
      id: 'demo-post-3',
      status: 'scheduled',
      text: 'Three signals that a factory is ready for direct-to-consumer:\n\n1. They already quote in the buyer\'s currency\n2. They answer technical questions without escalating\n3. Their sample lead time is under 10 days\n\nThread on Thursday.',
      createdAt: now - 1 * DAY,
      scheduledAt: now + 2 * DAY + 3 * HOUR,
      campaign: 'Factory Ops',
      media: [],
      versions: [
        {
          platform: 'linkedin',
          text: 'Three signals that a factory is ready for direct-to-consumer:\n\n1. They already quote in the buyer\'s currency\n2. They answer technical questions without escalating\n3. Their sample lead time is under 10 days',
        },
      ],
      targets: [],
    },
    {
      id: 'demo-post-4',
      status: 'draft',
      text: '',
      createdAt: now - 2 * HOUR,
      versions: [],
      targets: [],
      media: [],
    },
  ],
  metrics: [
    {
      accountId: 'demo-li-person',
      platform: 'linkedin',
      providerPostId: 'li_8812334',
      capturedAt: now - HOUR,
      impressions: 18420,
      likes: 412,
      comments: 63,
      shares: 88,
      clicks: 240,
    },
    {
      accountId: 'demo-fb-page',
      platform: 'facebook',
      providerPostId: 'fb_778121',
      capturedAt: now - HOUR,
      impressions: 9310,
      likes: 208,
      comments: 31,
      shares: 44,
      clicks: 96,
    },
    {
      accountId: 'demo-li-person',
      platform: 'linkedin',
      providerPostId: 'li_8819902',
      capturedAt: now - HOUR,
      impressions: 7640,
      likes: 155,
      comments: 24,
      shares: 19,
      clicks: 71,
    },
  ],
};
