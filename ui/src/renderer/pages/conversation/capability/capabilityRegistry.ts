/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * 能力注册表：把四类来源聚合成统一的 `CapabilityItem[]`。
 *
 * 设计要点：
 * - 四类来源并行拉取，任一来源失败只丢失该类，不影响其余（allSettled 容错）。
 * - 技能直接复用后端已提供的 `scenario_tags` / `audience_tags`，无需重新打标。
 * - 本模块只做「聚合」，不做网络决策；挂载动作在 CapabilityMountActions 中。
 */

import { ipcBridge } from '@/common';
import { mcpService } from '@/common/adapter/ipcBridge';
import { capabilityId, type CapabilityItem } from './capabilityTypes';

/** 未知结构的安全取值：把后端行当字典读，避免字段缺失导致整表崩。 */
const row = (value: unknown): Record<string, unknown> =>
  (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;

const strArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];

/** 描述过长会撑爆路由 prompt，统一截断（与技能市场 MAX_DESCRIPTION_LENGTH 对齐）。 */
const clip = (text: string, max = 220): string => (text.length > max ? `${text.slice(0, max)}...` : text);

/** 已挂载能力集合：用于幂等去重（技能名 / MCP server id / preset id）。 */
export interface MountedCapabilities {
  skills?: string[];
  mcp_server_ids?: string[];
  preset_id?: string;
}

export interface BuildRegistryOptions {
  /** 决策 5：是否纳入市场未安装能力（Hub 未安装项）。默认 true。 */
  includeMarket?: boolean;
  /** 当前会话已挂载的能力，用于标记 enabled。 */
  mounted?: MountedCapabilities;
}

/** 拉取已安装技能。 */
const loadSkills = async (mounted?: MountedCapabilities): Promise<CapabilityItem[]> => {
  const list = await ipcBridge.fs.listAvailableSkills.invoke();
  const mountedSkills = new Set(mounted?.skills ?? []);
  return (list ?? []).map((item) => {
    const r = row(item);
    const name = str(r.name);
    return {
      id: capabilityId('skill', name),
      type: 'skill' as const,
      name,
      description: clip(str(r.description) || name),
      tags: [...strArray(r.scenario_tags), ...strArray(r.audience_tags)],
      installed: true,
      enabled: mountedSkills.has(name),
      mount_payload: { name, location: str(r.location) },
    };
  });
};

/** 拉取 MCP 服务器（未启用也纳入，点击后走授权流程）。 */
const loadMcp = async (mounted?: MountedCapabilities): Promise<CapabilityItem[]> => {
  const list = await mcpService.listServers.invoke();
  const enabledIds = new Set(mounted?.mcp_server_ids ?? []);
  return (list ?? []).map((item) => {
    const r = row(item);
    const name = str(r.name);
    const id = str(r.id) || str(r.mcp_server_id) || name;
    return {
      id: capabilityId('mcp', name || id),
      type: 'mcp' as const,
      name: name || id,
      description: clip(str(r.description) || `MCP 服务器 ${name || id}`),
      tags: ['mcp', 'tool', ...strArray(r.tags)],
      installed: true,
      enabled: enabledIds.has(id),
      mount_payload: { server_id: id, name },
    };
  });
};

/** 拉取专家分身预设（决策 4：允许建议切换，需用户确认后新开会话）。 */
const loadPresets = async (mounted?: MountedCapabilities): Promise<CapabilityItem[]> => {
  const list = await ipcBridge.presets.list.invoke();
  return (list ?? []).map((item) => {
    const r = row(item);
    const id = str(r.id);
    const name = str(r.name) || id;
    return {
      id: capabilityId('preset', id || name),
      type: 'preset' as const,
      name,
      description: clip(str(r.description) || str(r.system_prompt) || `专家分身 ${name}`),
      tags: ['expert', 'preset', ...strArray(r.tags)],
      installed: true,
      enabled: mounted?.preset_id === id,
      mount_payload: { preset_id: id, name },
    };
  });
};

/** 拉取 Hub 扩展（决策 5：未安装项展示为「去安装」）。 */
const loadPlugins = async (options: BuildRegistryOptions): Promise<CapabilityItem[]> => {
  const list = await ipcBridge.hub.getExtensionList.invoke();
  const includeMarket = options.includeMarket !== false;
  return (list ?? [])
    .map((item) => {
      const r = row(item);
      const name = str(r.name);
      const installed = r.installed !== false;
      return {
        id: capabilityId('plugin', name),
        type: 'plugin' as const,
        name,
        description: clip(str(r.description) || name),
        tags: ['plugin', ...strArray(r.tags)],
        installed,
        enabled: false,
        mount_payload: { name, installed },
      };
    })
    .filter((item) => item.installed || includeMarket);
};

/**
 * 聚合成统一能力注册表。四类来源并行拉取，单个来源失败不影响其余。
 */
export const buildCapabilityRegistry = async (options: BuildRegistryOptions = {}): Promise<CapabilityItem[]> => {
  const results = await Promise.allSettled([
    loadSkills(options.mounted),
    loadMcp(options.mounted),
    loadPresets(options.mounted),
    loadPlugins(options),
  ]);

  const registry: CapabilityItem[] = [];
  results.forEach((result) => {
    if (result.status === 'fulfilled') registry.push(...result.value);
  });
  return registry.filter((item) => item.name.length > 0);
};
