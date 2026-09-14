/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// 内置人物形象 —— 「专家数字分身市场」的人物写实形象，复用为「形象库」素材。
//
// 背景：形象库（FigureLibraryPage）原先只展示用户自建立绘，新用户打开是空的；
// 这里把随应用分发的人物形象（`assets/experts/expert-NN.png`，与专家市场卡片
// 同源）注册成一组**内置形象**，让形象库、员工形象选择器与 B2B 工作台的名册
// 头像都能直接复用它们。
//
// 关键约束：内置形象**不落后端 figures 表**。为它们分配固定且合法的 UUIDv7
// （`0bf1…` 命名空间）后：
//   1. `appearance.custom_figure.figure_id` 可照常承载 —— 后端只校验
//      aspect / head_box 的数值合法性（`validate_persisted_appearance`），不查表；
//   2. 渲染层用 `builtinPersonFigure(id)` 命中内置表后**直接用打包资源**，
//      绝不请求 `/api/companion/figures/{id}/image`（该端点没有它的记录，会 404）；
//   3. 内置形象没有改名 / 删除入口，不会与用户自建形象混淆。

import type { IFigureMeta } from '@/common/adapter/ipcBridge';
import type { FigureId } from '@/common/types/ids';
import { parseFigureId } from '@/common/types/ids';

import person01 from '@renderer/assets/experts/expert-01.png';
import person02 from '@renderer/assets/experts/expert-02.png';
import person03 from '@renderer/assets/experts/expert-03.png';
import person04 from '@renderer/assets/experts/expert-04.png';
import person05 from '@renderer/assets/experts/expert-05.png';
import person06 from '@renderer/assets/experts/expert-06.png';
import person07 from '@renderer/assets/experts/expert-07.png';
import person08 from '@renderer/assets/experts/expert-08.png';
import person09 from '@renderer/assets/experts/expert-09.png';
import person10 from '@renderer/assets/experts/expert-10.png';
import person11 from '@renderer/assets/experts/expert-11.png';
import person12 from '@renderer/assets/experts/expert-12.png';
import person13 from '@renderer/assets/experts/expert-13.png';
import person14 from '@renderer/assets/experts/expert-14.png';
import person15 from '@renderer/assets/experts/expert-15.png';
import person16 from '@renderer/assets/experts/expert-16.png';

/** 内置人物形象（形象库 / 员工形象选择器 / 工作台名册头像共用）。 */
export interface BuiltinPersonFigure {
  /** 稳定 id（合法 UUIDv7，`0bf1…` 命名空间，不落后端 figures 表）。 */
  id: FigureId;
  /** 展示名。 */
  name: string;
  /** 随包分发的图片资源 URL。 */
  src: string;
}

const PERSON_IMAGES: readonly string[] = [
  person01,
  person02,
  person03,
  person04,
  person05,
  person06,
  person07,
  person08,
  person09,
  person10,
  person11,
  person12,
  person13,
  person14,
  person15,
  person16,
];

/** 内置形象 id 命名空间：`0bf10000-0000-7000-8000-0000000000NN`（合法 UUIDv7）。 */
const BUILTIN_ID_PREFIX = '0bf10000-0000-7000-8000-';

const builtinFigureId = (serial: number): FigureId =>
  parseFigureId(`${BUILTIN_ID_PREFIX}${String(serial).padStart(12, '0')}`);

export const BUILTIN_PERSON_FIGURES: readonly BuiltinPersonFigure[] = PERSON_IMAGES.map((src, index) => ({
  id: builtinFigureId(index + 1),
  name: `专家形象 ${String(index + 1).padStart(2, '0')}`,
  src,
}));

const BUILTIN_BY_ID: ReadonlyMap<string, BuiltinPersonFigure> = new Map(
  BUILTIN_PERSON_FIGURES.map((figure) => [figure.id as string, figure])
);

/** 命中内置形象；未命中（含空值 / 用户自建 figure id）返回 undefined。 */
export const builtinPersonFigure = (id?: string | null): BuiltinPersonFigure | undefined =>
  id ? BUILTIN_BY_ID.get(id) : undefined;

export const isBuiltinFigureId = (id?: string | null): boolean => builtinPersonFigure(id) !== undefined;

/** 内置头像裁剪框：人物写实半身像，脸部大致在图片中上部（图片按 1:1 处理）。 */
const BUILTIN_HEAD_BOX = { x: 0.26, y: 0.04, w: 0.48, h: 0.48 } as const;

/**
 * 按 `IFigureMeta` 形状暴露内置形象：形象库缩略图、员工形象选择器与
 * `figureToCustomPatch` 都能与用户自建形象走**同一条**渲染/保存路径。
 */
export const builtinFigureMeta = (figure: BuiltinPersonFigure): IFigureMeta => ({
  figure_id: figure.id,
  name: figure.name,
  aspect: 1,
  head_box: { ...BUILTIN_HEAD_BOX },
  size_tier: 'm',
  created_at: 0,
});

/** FNV-1a + murmur3 finalizer：同一 seed 永远挑到同一张形象（避免每次渲染换脸）。 */
const hashSeed = (seed: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  // avalanche：FNV 低位混合不足，直接取模会让相近 id 撞同一张脸。
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909);
  hash ^= hash >>> 16;
  return hash >>> 0;
};

/**
 * 按 seed（专家 id / 名称）稳定挑一张人物形象 —— B2B 工作台名册里
 * 「专家 / 员工」的写实头像即由此分配，看起来随机但刷新不变。
 */
export const pickPersonFigure = (seed: string): BuiltinPersonFigure =>
  BUILTIN_PERSON_FIGURES[hashSeed(seed) % BUILTIN_PERSON_FIGURES.length];

export const pickPersonAvatarSrc = (seed: string): string => pickPersonFigure(seed).src;

/**
 * 一次性给一组 seed（一份名册）分配人物形象：哈希打散后做线性探测消解冲突，
 * 保证同一屏内**尽量不撞脸**（≤ 形象总数时互不重复），且分配结果对同一份
 * 名册是稳定的。名册的顺序变化不影响单个 seed 的选择倾向。
 */
export function assignPersonFigures(seeds: readonly string[]): ReadonlyMap<string, BuiltinPersonFigure> {
  const total = BUILTIN_PERSON_FIGURES.length;
  const used = new Set<number>();
  const assigned = new Map<string, BuiltinPersonFigure>();
  for (const seed of seeds) {
    let cursor = hashSeed(seed) % total;
    let guard = 0;
    while (used.has(cursor) && guard < total) {
      cursor = (cursor + 1) % total;
      guard += 1;
    }
    used.add(cursor);
    assigned.set(seed, BUILTIN_PERSON_FIGURES[cursor]);
  }
  return assigned;
}
