/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// 内置专家头像本地资源（按 slug 索引）。
//
// 背景：expert_catalog 表的 `avatar` 字段是字符串 URL/路径，但内置种子
// 头像属于私有资料，不适合走公网 URL 或对象存储 CDN。我们改为：种子数据
// 里的 `avatar` 留空（NULL），前端按 slug 命中本地打包资源。这样：
//   1. 头像资源随应用分发，离线可读、隐私不外泄；
//   2. 后端 SQL 不再写入每张图的路径，仓库体积干净；
//   3. 自定义专家仍可使用后端 `avatar` 字段（URL 或文件协议）。

import expertAvatar01 from './expert-01.png';
import expertAvatar02 from './expert-02.png';
import expertAvatar03 from './expert-03.png';
import expertAvatar04 from './expert-04.png';
import expertAvatar05 from './expert-05.png';
import expertAvatar06 from './expert-06.png';
import expertAvatar07 from './expert-07.png';
import expertAvatar08 from './expert-08.png';
import expertAvatar09 from './expert-09.png';
import expertAvatar10 from './expert-10.png';
import expertAvatar11 from './expert-11.png';
import expertAvatar12 from './expert-12.png';
import expertAvatar13 from './expert-13.png';
import expertAvatar14 from './expert-14.png';
import expertAvatar15 from './expert-15.png';

/** slug → 本地头像资源（与后端 seed 的 expert_catalog.slug 对齐）。 */
const BUILTIN_AVATAR_BY_SLUG: Record<string, string> = {
  'liloavatar-chairman': expertAvatar01,
  'writing-master': expertAvatar02,
  copywriting: expertAvatar03,
  'biz-strategist': expertAvatar04,
  'data-analyst': expertAvatar05,
  mindmap: expertAvatar06,
  'emotional-healer': expertAvatar07,
  'code-reviewer': expertAvatar08,
  'study-mentor': expertAvatar09,
  translator: expertAvatar10,
  encyclopedia: expertAvatar11,
  summarizer: expertAvatar12,
  academic: expertAvatar13,
  'email-writer': expertAvatar14,
  'meeting-minutes': expertAvatar15,
};

/**
 * 解析最终头像 URL：
 * 1) 后端返回的 avatar 优先（支持自定义专家的 URL/资产协议）；
 * 2) 否则按 slug 命中内置专家的本地头像资源；
 * 3) 都无则返回 undefined（让调用方走首字彩色圆 fallback）。
 */
export function resolveExpertAvatar(
  avatar: string | null | undefined,
  slug?: string | null,
): string | undefined {
  if (avatar) return avatar;
  if (slug) {
    const local = BUILTIN_AVATAR_BY_SLUG[slug];
    if (local) return local;
  }
  return undefined;
}