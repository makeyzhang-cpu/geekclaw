/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// 极客出海 Agent —— 专家技能库的前端持久化（localStorage）。
// 后端暂无 skill 相关命令，技能数据在本端落地，支持导入/导出 JSON。

import { useCallback, useEffect, useState } from 'react';
import { expertSkills as defaultSkills, type ExpertSkill } from './data';

const STORAGE_KEY = 'geekclaw.expert.skills.v1';

function cloneDefaults(): ExpertSkill[] {
  return JSON.parse(JSON.stringify(defaultSkills)) as ExpertSkill[];
}

function load(): ExpertSkill[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as ExpertSkill[];
      }
    }
  } catch {
    /* 解析失败则回退默认 */
  }
  return cloneDefaults();
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `skill-${crypto.randomUUID()}`;
  }
  return `skill-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function isValidSkill(item: unknown): item is ExpertSkill {
  if (!item || typeof item !== 'object') return false;
  const s = item as Partial<ExpertSkill>;
  return typeof s.id === 'string' && typeof s.name === 'string' && typeof s.category === 'string';
}

export interface UseExpertSkillsResult {
  skills: ExpertSkill[];
  /** 新增或更新一个技能（按 id 匹配，不存在则追加） */
  upsertSkill: (item: ExpertSkill) => void;
  /** 删除指定 id 的技能 */
  removeSkill: (id: string) => void;
  /** 恢复为内置 21 个默认技能 */
  resetSkills: () => void;
  /** 从 JSON 数组导入技能（merge：按 id 更新/追加；replace：完全替换） */
  importSkills: (items: ExpertSkill[], mode?: 'merge' | 'replace') => number;
  /** 将当前技能库导出为 JSON 字符串 */
  exportSkills: () => string;
  /** 生成一个未使用的技能 id */
  createId: () => string;
  /** 在当前技能库中查找指定 id */
  findSkill: (id: string) => ExpertSkill | undefined;
}

export function useExpertSkills(): UseExpertSkillsResult {
  const [skills, setSkills] = useState<ExpertSkill[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(skills));
    } catch {
      /* 写入失败不影响内存态 */
    }
  }, [skills]);

  const upsertSkill = useCallback((item: ExpertSkill) => {
    setSkills((prev) => {
      const idx = prev.findIndex((s) => s.id === item.id);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = item;
        return next;
      }
      return [...prev, item];
    });
  }, []);

  const removeSkill = useCallback((id: string) => {
    setSkills((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const resetSkills = useCallback(() => {
    setSkills(cloneDefaults());
  }, []);

  const importSkills = useCallback(
    (items: ExpertSkill[], mode: 'merge' | 'replace' = 'merge'): number => {
      const valid = items.filter(isValidSkill);
      if (valid.length === 0) return 0;
      if (mode === 'replace') {
        setSkills(valid);
        return valid.length;
      }
      setSkills((prev) => {
        const next = prev.slice();
        for (const item of valid) {
          const idx = next.findIndex((s) => s.id === item.id);
          if (idx >= 0) next[idx] = item;
          else next.push(item);
        }
        return next;
      });
      return valid.length;
    },
    []
  );

  const exportSkills = useCallback((): string => {
    return JSON.stringify(skills, null, 2);
  }, [skills]);

  const findSkill = useCallback(
    (id: string): ExpertSkill | undefined => {
      return skills.find((s) => s.id === id);
    },
    [skills]
  );

  return {
    skills,
    upsertSkill,
    removeSkill,
    resetSkills,
    importSkills,
    exportSkills,
    createId: newId,
    findSkill,
  };
}
