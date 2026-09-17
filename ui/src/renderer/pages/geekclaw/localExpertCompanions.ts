/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 本地「专家 → 数字员工」雇佣台账。
 *
 * 专家目录（165 位专业专家 / 分身专家董事会）完全内置在前端，没有云端专家行，
 * 因此「雇佣」= **纯本地** 建一个数字员工，并把它的人设写进 companion 的
 * `persona.custom`（后端 `build_companion_system_prompt` 会把它拼进系统提示词）。
 *
 * 台账（localStorage）只记「哪条专家 → 哪个 companion + 展示用元信息」，用来：
 *   1. 幂等 —— 同一专家反复点「雇佣」不会堆出一串员工；
 *   2. 自愈 —— 员工被删掉后再次雇佣会重建；
 *   3. 「我的专家」不再需要重新加载专家数据文件即可渲染。
 *
 * 命名空间：市场与董事会各加前缀（`market:` / `board:`），互不干扰。
 */

import { ipcBridge } from '@/common';
import { DEFAULT_CHARACTER_ID } from '@renderer/pages/companion/characters';
import type { CompanionId } from '@/common/types/ids';
import type { ICompanionWithStatus } from '@/common/adapter/ipcBridge';

const STORE_KEY = 'geekclaw:local-experts:v1';

export type LocalExpertSource = 'market' | 'board';

export interface LocalExpertHireRecord {
  companion_id: CompanionId;
  /** 员工名（专家名）。 */
  name: string;
  /** 卡片副标题（分类 / 分组）。 */
  subtitle: string;
  source: LocalExpertSource;
}

export type LocalExpertHires = Record<string, LocalExpertHireRecord>;

export const MARKET_KEY_PREFIX = 'market:';
export const BOARD_KEY_PREFIX = 'board:';

export function readHires(): LocalExpertHires {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as LocalExpertHires;
    }
    return {};
  } catch {
    return {};
  }
}

function writeHires(map: LocalExpertHires): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(map));
  } catch {
    /* 存储被禁用（隐私模式）时静默降级：本次会话仍能用，只是不再幂等。 */
  }
}

/** 该专家的已登记记录（可能已不存在于名册，交给调用方判定）。 */
export function hireRecordFor(key: string): LocalExpertHireRecord | null {
  return readHires()[key] ?? null;
}

/** 同一 key 的并发雇佣去重（连点两下只建一个员工）。 */
const inflight = new Map<string, Promise<CompanionId>>();

export interface HireLocalExpertOptions {
  /** 台账键（含命名空间前缀）。 */
  key: string;
  /** 员工名（通常就是专家名）。 */
  name: string;
  /** 卡片副标题。 */
  subtitle: string;
  /** 来源（市场 / 董事会）。 */
  source: LocalExpertSource;
  /** 人设正文（写进 persona.custom）。 */
  persona: string;
  /** 当前名册，用于判断已登记的 companion 是否还在（被删则重建）。 */
  roster: ICompanionWithStatus[];
}

/**
 * 创建（或复用）承载某位专家人设的本地数字员工，返回其 `companion_id`。
 *
 * 幂等：台账命中且该员工仍在名册 → 直接返回，不重复创建。
 */
export async function hireLocalExpert(opts: HireLocalExpertOptions): Promise<CompanionId> {
  const { key, name, subtitle, source, persona, roster } = opts;
  const running = inflight.get(key);
  if (running) return running;

  const task = (async (): Promise<CompanionId> => {
    const map = readHires();
    const registered = map[key];
    if (registered && roster.some((c) => c.companion_id === registered.companion_id)) {
      return registered.companion_id;
    }
    // 登记存在但员工已被删除 → 清掉脏台账，走重建。
    if (registered) {
      delete map[key];
      writeHires(map);
    }

    const profile = await ipcBridge.companion.createCompanion.invoke({
      name: name.slice(0, 30),
      character: DEFAULT_CHARACTER_ID,
    });
    await ipcBridge.companion.patchCompanion.invoke({
      companion_id: profile.companion_id,
      patch: { persona: { custom: persona } },
    });

    const next = readHires();
    next[key] = { companion_id: profile.companion_id, name, subtitle, source };
    writeHires(next);
    return profile.companion_id;
  })();

  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

/** 台账里所有登记（按前缀过滤）。 */
export function listHires(prefix?: string): Array<{ key: string; record: LocalExpertHireRecord }> {
  return Object.entries(readHires())
    .filter(([key]) => (prefix ? key.startsWith(prefix) : true))
    .map(([key, record]) => ({ key, record }));
}

/** 台账 ∩ 现役名册 = 真正可用的登记（员工被删则自动剔除）。 */
export function liveHires(
  roster: ICompanionWithStatus[],
  prefix?: string
): Array<{ key: string; record: LocalExpertHireRecord }> {
  const live = new Set(roster.map((c) => c.companion_id));
  return listHires(prefix).filter(({ record }) => live.has(record.companion_id));
}

/** 去掉命名空间前缀，还原专家 id。 */
export function stripPrefix(key: string): string {
  const idx = key.indexOf(':');
  return idx === -1 ? key : key.slice(idx + 1);
}
