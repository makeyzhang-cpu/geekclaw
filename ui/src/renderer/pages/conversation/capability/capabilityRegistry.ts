/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Capability registry — aggregate the four live capability sources (skills /
 * experts / MCP / plugins) plus market entries (market_install) into a single
 * `CapabilityItem[]` for the router.
 *
 * Key contracts:
 *   - All four live sources are fetched in parallel and joined with
 *     `Promise.allSettled` so a single broken source cannot take the bar down.
 *   - The four returned types match the backend's `CapabilityCandidate.type`
 *     vocabulary (`skill` / `expert` / `mcp` / `plugin` / `market_install`).
 *   - Items that the user already has mounted (per the `mounted` hint) are
 *     flagged `installed: true` and the recall stage skips them on purpose,
 *     so the bar never suggests something that is already live.
 */

import { ipcBridge } from '@/common';
import { mcpService } from '@/common/adapter/ipcBridge';

import type { CapabilityItem } from './capabilityTypes';

const row = (value: unknown): Record<string, unknown> =>
  (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;

const strArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];

// Truncate long descriptions before they enter the routing prompt. 220 chars
// mirrors the `MAX_DESCRIPTION_LENGTH` the skill market uses.
const clip = (text: string, max = 220): string => (text.length > max ? `${text.slice(0, max)}…` : text);

/** Build a stable per-type id: `<type>:<name-or-id>`. */
const cid = (type: CapabilityItem['type'], key: string): string => `${type}:${key}`;

export interface MountedCapabilities {
  /** Local skill names already mounted on the active conversation. */
  skills?: string[];
  /** MCP server ids already enabled. */
  mcp_server_ids?: string[];
  /** Currently active expert-preset id (the only one usable at a time). */
  preset_id?: string;
}

export interface BuildRegistryOptions {
  /** Decision 5: include market entries (installed: false). Default true. */
  includeMarket?: boolean;
  /** Currently-mounted items, used to mark `installed: true` accurately. */
  mounted?: MountedCapabilities;
}

const loadSkills = async (mounted?: MountedCapabilities): Promise<CapabilityItem[]> => {
  const list = await ipcBridge.fs.listAvailableSkills.invoke();
  const mountedSkills = new Set(mounted?.skills ?? []);
  return (list ?? [])
    .map<CapabilityItem | null>((item) => {
      const r = row(item);
      const name = str(r.name);
      if (!name) return null;
      const isMounted = mountedSkills.has(name);
      return {
        id: cid('skill', name),
        type: 'skill',
        label: name,
        name,
        description: clip(str(r.description) || name),
        tags: [...strArray(r.scenario_tags), ...strArray(r.audience_tags)],
        installed: true,
        // Items already mounted do not need to be suggested again — the
        // recall step uses `installed=true` as a hard skip.
        // We keep them in the registry for refresh / detail rendering.
        payload: { kind: 'skill', name, location: str(r.location), isMounted },
      };
    })
    .filter((x): x is CapabilityItem => x !== null);
};

const loadMcp = async (mounted?: MountedCapabilities): Promise<CapabilityItem[]> => {
  const list = await mcpService.listServers.invoke();
  const enabledIds = new Set(mounted?.mcp_server_ids ?? []);
  return (list ?? [])
    .map<CapabilityItem | null>((item) => {
      const r = row(item);
      const name = str(r.name);
      const id = str(r.id) || str(r.mcp_server_id) || name;
      if (!id && !name) return null;
      const key = id || name;
      return {
        id: cid('mcp', key),
        type: 'mcp',
        label: name || key,
        name: name || key,
        description: clip(str(r.description) || `MCP 服务器 ${name || key}`),
        tags: ['mcp', 'tool', ...strArray(r.tags)],
        installed: true,
        payload: { kind: 'mcp', server_id: id, name, enabled: enabledIds.has(id) },
      };
    })
    .filter((x): x is CapabilityItem => x !== null);
};

const loadExperts = async (mounted?: MountedCapabilities): Promise<CapabilityItem[]> => {
  const list = await ipcBridge.presets.list.invoke();
  return (list ?? [])
    .map<CapabilityItem | null>((item) => {
      const r = row(item);
      const id = str(r.id);
      const name = str(r.name) || id;
      if (!id && !name) return null;
      const key = id || name;
      return {
        id: cid('expert', key),
        type: 'expert',
        label: name || key,
        name: name || key,
        description: clip(str(r.description) || str(r.system_prompt) || `专家分身 ${name || key}`),
        tags: ['expert', 'preset', ...strArray(r.tags)],
        installed: true,
        payload: { kind: 'expert', preset_id: id, name, active: mounted?.preset_id === id },
      };
    })
    .filter((x): x is CapabilityItem => x !== null);
};

const loadMarketAndPlugins = async (options: BuildRegistryOptions): Promise<CapabilityItem[]> => {
  const includeMarket = options.includeMarket !== false;
  const list = await ipcBridge.hub.getExtensionList.invoke();
  return (list ?? [])
    .map<CapabilityItem | null>((item) => {
      const r = row(item);
      const name = str(r.name);
      if (!name) return null;
      const installed = r.installed !== false;
      if (!installed && !includeMarket) return null;
      return {
        id: cid(installed ? 'plugin' : 'market_install', name),
        type: installed ? 'plugin' : 'market_install',
        label: name,
        name,
        description: clip(str(r.description) || name),
        tags: ['plugin', ...strArray(r.tags)],
        installed,
        payload: { kind: 'plugin', name, installed },
      };
    })
    .filter((x): x is CapabilityItem => x !== null);
};

/**
 * Build the live capability registry. Fetches the four sources in parallel.
 * Per source: a failure means that single source is dropped — the rest still
 * surface, so a broken market tab cannot take the suggestion bar down.
 */
export const buildCapabilityRegistry = async (
  options: BuildRegistryOptions = {}
): Promise<CapabilityItem[]> => {
  const results = await Promise.allSettled([
    loadSkills(options.mounted),
    loadMcp(options.mounted),
    loadExperts(options.mounted),
    loadMarketAndPlugins(options),
  ]);

  const registry: CapabilityItem[] = [];
  results.forEach((result) => {
    if (result.status === 'fulfilled') registry.push(...result.value);
    else
      // eslint-disable-next-line no-console
      console.warn('[capability] registry source failed:', result.reason);
  });
  return registry.filter((item) => item.name.length > 0);
};
