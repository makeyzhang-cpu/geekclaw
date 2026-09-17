/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 本地专家数据访问层 —— 完全离线，不依赖云端 `/api/experts/*`。
 *
 * 数据由 `scripts`（离线解码「165名专家」zip 与「分身专家董事会」技能包）生成，
 * 落盘为两个 JSON：`professionalExperts.json`(165 位 / 18 分类) 与
 * `boardExperts.json`（主席台 + 13 位董事 + 3 个文书技能）。
 *
 * 两个文件合计 ~3.8MB，因此**一律走 `import()` 动态加载**：Vite 会切成独立 chunk，
 * 只有真正打开「专家数字分身市场 / 分身专家董事会」时才拉取，首屏不受影响。
 */

/** 一位专业专家（来自「165名专家」）。 */
export interface ProfessionalExpert {
  /** ascii slug，来自 SKILL.md frontmatter `name`（如 `kongzi-perspective`）。 */
  id: string;
  /** 展示名（如「孔子」）。 */
  name: string;
  /** 分类名（如「中国哲学家」），同时用作卡片副标题。 */
  title: string;
  /** 分类名。 */
  category: string;
  /** 从描述里抽出的第一句，用于卡片一句话。 */
  tagline: string;
  /** 完整简介（详情抽屉用）。 */
  description: string;
  /** 完整人格设定（SKILL.md 正文），注入数字员工 persona.custom。 */
  persona: string;
}

export interface ExpertCategory {
  id: string;
  name: string;
  count: number;
}

export interface ProfessionalExpertsData {
  total: number;
  categories: ExpertCategory[];
  experts: ProfessionalExpert[];
}

/** 董事会成员 / 文书技能。 */
export interface BoardMember {
  id: string;
  name: string;
  /** 分组名（如「投资与风险」）。 */
  title: string;
  /** 分组名。 */
  group: string;
  tagline: string;
  description: string;
  /** 完整人格设定。 */
  persona: string;
}

export interface BoardData {
  /** 主席台（expert-council）。 */
  council: BoardMember;
  /** 13 位董事。 */
  members: BoardMember[];
  /** 3 个 A4 文书技能。 */
  tools: BoardMember[];
}

let professionalCache: ProfessionalExpertsData | null = null;
let boardCache: BoardData | null = null;

/** 加载 165 位专业专家（进程内缓存）。 */
export async function loadProfessionalExperts(): Promise<ProfessionalExpertsData> {
  if (professionalCache) return professionalCache;
  const mod = await import('./professionalExperts.json');
  professionalCache = (mod.default ?? mod) as unknown as ProfessionalExpertsData;
  return professionalCache;
}

/** 加载分身专家董事会（进程内缓存）。 */
export async function loadBoardExperts(): Promise<BoardData> {
  if (boardCache) return boardCache;
  const mod = await import('./boardExperts.json');
  boardCache = (mod.default ?? mod) as unknown as BoardData;
  return boardCache;
}

/** 关键词匹配：名称 / 分类 / 一句话 / 简介。 */
export function matchesQuery(
  item: { name: string; category?: string; title?: string; tagline?: string; description?: string },
  q: string
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [item.name, item.category, item.title, item.tagline, item.description]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return hay.includes(needle);
}
