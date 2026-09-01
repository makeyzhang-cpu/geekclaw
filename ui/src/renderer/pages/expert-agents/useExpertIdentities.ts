/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// 极客出海 Agent —— 专家身份的前端持久化（localStorage）。
// 后端暂无 expert 相关命令，故身份数据在本端落地，重启后保留用户编辑结果。

import { useCallback, useEffect, useState } from 'react';
import { expertIdentities as defaultIdentities, type ExpertIdentity } from './data';

const STORAGE_KEY = 'geekclaw.expert.identities.v1';

function cloneDefaults(): ExpertIdentity[] {
  return JSON.parse(JSON.stringify(defaultIdentities)) as ExpertIdentity[];
}

function mergeWithDefaults(saved: ExpertIdentity[]): ExpertIdentity[] {
  const defaults = cloneDefaults();
  const defaultById = new Map(defaults.map((d) => [d.id, d]));
  const savedById = new Map(saved.map((s) => [s.id, s]));
  // 保留用户已有身份，并把新增默认身份追加到末尾。
  const merged: ExpertIdentity[] = saved.map((s) => {
    const d = defaultById.get(s.id);
    return d ? { ...d, presetId: s.presetId } : s;
  });
  for (const d of defaults) {
    if (!savedById.has(d.id)) {
      merged.push(d);
    }
  }
  return merged;
}

function load(): ExpertIdentity[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return mergeWithDefaults(parsed as ExpertIdentity[]);
      }
    }
  } catch {
    /* 解析失败则回退默认 */
  }
  return cloneDefaults();
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `identity-${crypto.randomUUID()}`;
  }
  return `identity-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export interface UseExpertIdentitiesResult {
  identities: ExpertIdentity[];
  /** 新增或更新一个身份（按 id 匹配，不存在则追加） */
  upsertIdentity: (item: ExpertIdentity) => void;
  /** 删除指定 id 的身份 */
  removeIdentity: (id: string) => void;
  /** 恢复为内置 10 个默认身份 */
  resetIdentities: () => void;
  /** 生成一个未使用的身份 id（用于新建） */
  createId: () => string;
}

export function useExpertIdentities(): UseExpertIdentitiesResult {
  const [identities, setIdentities] = useState<ExpertIdentity[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(identities));
    } catch {
      /* 写入失败（如隐私模式）不影响内存态 */
    }
  }, [identities]);

  const upsertIdentity = useCallback((item: ExpertIdentity) => {
    setIdentities((prev) => {
      const idx = prev.findIndex((i) => i.id === item.id);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = item;
        return next;
      }
      return [...prev, item];
    });
  }, []);

  const removeIdentity = useCallback((id: string) => {
    setIdentities((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const resetIdentities = useCallback(() => {
    setIdentities(cloneDefaults());
  }, []);

  return { identities, upsertIdentity, removeIdentity, resetIdentities, createId: newId };
}
