/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mount-action helpers. One per capability type. They consume the
 * `payload` blob attached to each `CapabilityItem` and translate it into the
 * concrete side-effect that the user actually wants when they tap a card.
 *
 * Decisions (P0 step 4):
 *   - skill       → mount locally + push into `extra.skills` so the active
 *                   conversation picks them up.
 *   - expert      → create a brand-new conversation via
 *                   `buildAgentConversationParams` (the only existing path for
 *                   switching personas); navigation is the caller's job.
 *   - mcp         → opt-in only: prompt the user with a confirmation modal,
 *                   then call `mcpService.updateServer(enabled=true)`.
 *   - plugin      → toggle the plugin via the hub install/uninstall APIs.
 *   - market_install → jump to the market page; the plugin entry will be
 *                       installed from there and re-surface as `plugin` next
 *                       time the registry is built.
 *
 * Every helper returns a discriminated `{ ok, kind }` so the bar can show a
 * toast / state update without swallowing the failure silently.
 */

import { ipcBridge } from '@/common';
import { mcpService } from '@/common/adapter/ipcBridge';
import type { ConversationId } from '@/common/types/ids';

import type { CapabilityDecision, CapabilityItem } from './capabilityTypes';

export type MountResult =
  | { ok: true; kind: 'skill_mounted'; count: number }
  | { ok: true; kind: 'expert_launched'; navigation_target: string }
  | { ok: true; kind: 'mcp_pending'; reason: 'consent_required' }
  | { ok: true; kind: 'plugin_toggled'; enabled: boolean }
  | { ok: true; kind: 'market_jumped'; target: string }
  | { ok: false; kind: 'unknown_type' }
  | { ok: false; kind: 'item_missing' }
  | { ok: false; kind: 'mount_failed'; error: string };

/** Resolve the live `CapabilityItem` for a decision from the registry. */
const lookupItem = (
  decision: CapabilityDecision,
  registry: CapabilityItem[]
): CapabilityItem | undefined => registry.find((x) => x.id === decision.id);

/** Skill: mount the skill and add the skill name into `extra.skills` for the
 *  currently active conversation. `conversationId` is the live conversation
 *  id from the registry context — when missing the call degrades to a noop. */
const mountSkill = async (
  decision: CapabilityDecision,
  item: CapabilityItem,
  conversationId?: ConversationId
): Promise<MountResult> => {
  const payload = (item.payload ?? {}) as { name?: string; location?: string; isMounted?: boolean };
  if (!payload.name) return { ok: false, kind: 'item_missing' };
  if (payload.isMounted) return { ok: true, kind: 'skill_mounted', count: 0 };
  try {
    if (payload.location && conversationId) {
      await ipcBridge.fs.materializeSkillsForAgent.invoke({
        conversation_id: conversationId,
        skills: [payload.name],
      });
    }
    return { ok: true, kind: 'skill_mounted', count: 1 };
  } catch (error) {
    return {
      ok: false,
      kind: 'mount_failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

/** Expert: navigate the user to the preset preview page. Switching personas
 *  always requires the user to review the system prompt / confirm before
 *  creating a conversation, so we DO NOT auto-create conversations from a
 *  suggestion card. The preview page already wraps creation behind a button. */
const launchExpert = async (_decision: CapabilityDecision, item: CapabilityItem): Promise<MountResult> => {
  const payload = (item.payload ?? {}) as { preset_id?: string; name?: string };
  if (!payload.preset_id) return { ok: false, kind: 'item_missing' };
  return {
    ok: true,
    kind: 'expert_launched',
    navigation_target: `/expert-agents/preview/${encodeURIComponent(payload.preset_id)}`,
  };
};

/** MCP: requires explicit user consent (decision 3). The helper does NOT
 *  call the toggle directly — it returns a sentinel and lets the UI show
 *  the consent modal that flips the actual toggle. */
const requestMcp = async (_decision: CapabilityDecision, item: CapabilityItem): Promise<MountResult> => {
  const payload = (item.payload ?? {}) as { server_id?: string; name?: string };
  if (!payload.server_id) return { ok: false, kind: 'item_missing' };
  return { ok: true, kind: 'mcp_pending', reason: 'consent_required' };
};

/** After consent, perform the actual toggle. Called from the consent modal's
 *  "启用" button. */
export const enableMcpServer = async (server_id: string): Promise<MountResult> => {
  try {
    await mcpService.updateServer.invoke({ server_id, enabled: true } as never);
    return { ok: true, kind: 'plugin_toggled', enabled: true };
  } catch (error) {
    return {
      ok: false,
      kind: 'mount_failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

/** Plugin: forward to the existing hub install/uninstall surface. */
const togglePlugin = async (decision: CapabilityDecision, item: CapabilityItem): Promise<MountResult> => {
  const payload = (item.payload ?? {}) as { name?: string; installed?: boolean };
  if (!payload.name) return { ok: false, kind: 'item_missing' };
  try {
    if (payload.installed) {
      await ipcBridge.hub.uninstall.invoke({ name: payload.name } as never);
      return { ok: true, kind: 'plugin_toggled', enabled: false };
    }
    await ipcBridge.hub.install.invoke({ name: payload.name } as never);
    return { ok: true, kind: 'plugin_toggled', enabled: true };
  } catch (error) {
    return {
      ok: false,
      kind: 'mount_failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

/** `market_install` placeholder items — jump to the corresponding market
 *  page so the user can complete installation from the existing UI. */
const jumpToMarket = async (decision: CapabilityDecision, item: CapabilityItem): Promise<MountResult> => {
  const payload = (item.payload ?? {}) as { name?: string };
  if (!payload.name) return { ok: false, kind: 'item_missing' };
  return { ok: true, kind: 'market_jumped', target: `/market?package=${encodeURIComponent(payload.name)}` };
};

/** Entry: dispatch by type. The caller passes the live registry so item
 *  payload can be resolved into a concrete side-effect, plus the current
 *  conversation id when the action needs to mutate conversation state. */
export const runMountAction = async (
  decision: CapabilityDecision,
  registry: CapabilityItem[],
  conversationId?: ConversationId
): Promise<MountResult> => {
  const item = lookupItem(decision, registry);
  if (!item) return { ok: false, kind: 'item_missing' };

  switch (decision.type) {
    case 'skill':
      return mountSkill(decision, item, conversationId);
    case 'expert':
      return launchExpert(decision, item);
    case 'mcp':
      return requestMcp(decision, item);
    case 'plugin':
      return togglePlugin(decision, item);
    case 'market_install':
      return jumpToMarket(decision, item);
    default:
      return { ok: false, kind: 'unknown_type' };
  }
};
