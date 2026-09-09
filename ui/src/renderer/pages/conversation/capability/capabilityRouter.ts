/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Capability router (P0 "建议模式") — frontend side.
 *
 * Pipeline:
 *   1. registry          aggregates live candidates from skills / experts / MCP / plugins
 *                        / market_install sources. Any source that fails is dropped
 *                        via `Promise.allSettled`, so a single broken market cannot
 *                        take the suggestion bar down.
 *   2. recallCandidates  local scoring over the candidates that survived — pure,
 *                        unit-testable, no network.
 *   3. backend /api/capability/route gives the LLM the recalled shortlist and asks
 *      for ranked ids; ids the LLM invents (hallucination) are dropped here.
 *   4. fallbackFromRecall is what we show when the network call fails / times out
 *      / returns unparseable — local recall only, no LLM, never blocks the user.
 */

import {
  DEFAULT_CAPABILITY_ROUTING_CONFIG,
  type CapabilityDecision,
  type CapabilityItem,
  type CapabilityRoutingConfig,
} from './capabilityTypes';

export * from './capabilityTypes';

// -------------------------- Local recall (pure) ---------------------------

const tokenize = (text: string): string[] => {
  const normalized = text.toLowerCase();
  const words = normalized
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
  const tokens = new Set<string>(words);
  const cjk = normalized.replace(/[^\p{Script=Han}]+/gu, '');
  for (let i = 0; i + 2 <= cjk.length; i += 1) tokens.add(cjk.slice(i, i + 2));
  return [...tokens];
};

const scoreCapability = (item: CapabilityItem, tokens: string[]): number => {
  // Suggested-but-already-mounted items stay out of the bar (idempotent).
  if (item.installed) return -1;
  const tags = item.tags.join(' ').toLowerCase();
  const name = item.name.toLowerCase();
  const description = item.description.toLowerCase();
  let score = 0;
  tokens.forEach((token) => {
    if (tags.includes(token)) score += 3;
    if (name.includes(token)) score += 2;
    if (description.includes(token)) score += 1;
  });
  return score;
};

export interface RecallOptions {
  /** Max candidates returned (default 8, fed to the LLM). */
  limit?: number;
  /** When false, only items that are locally installed are considered. */
  includeMarket?: boolean;
}

export const recallCandidates = (
  registry: CapabilityItem[],
  message: string,
  history: string[] = [],
  options: RecallOptions = {}
): CapabilityItem[] => {
  const limit = options.limit ?? 8;
  const tokens = tokenize([...history.slice(-2), message].join(' '));

  return registry
    .filter((item) => options.includeMarket === false ? item.installed : true)
    .map((item) => ({ item, score: scoreCapability(item, tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.item);
};

// ----------------------- Backend response handling -------------------------

/**
 * Validate the backend's flat-array decision list against the candidate set
 * we sent it. Any id invented by the LLM is dropped silently here so we never
 * hand the UI a path that does not exist in the registry.
 */
export const validateDecision = (
  rawDecisions: ReadonlyArray<CapabilityDecision> | null | undefined,
  candidates: CapabilityItem[],
  config: CapabilityRoutingConfig = DEFAULT_CAPABILITY_ROUTING_CONFIG
): CapabilityDecision[] => {
  if (!Array.isArray(rawDecisions)) return [];

  const allowed = new Map(candidates.map((item) => [item.id, item]));
  const out: CapabilityDecision[] = [];

  for (const entry of rawDecisions) {
    if (!entry || typeof entry !== 'object') continue;
    const id = typeof entry.id === 'string' ? entry.id : '';
    const item = allowed.get(id);
    if (!item) continue; // hallucinated id — drop.
    if (typeof entry.confidence !== 'number' || !Number.isFinite(entry.confidence)) continue;

    // Type-based policy gate: MCP / preset switches need explicit user opt-in
    // (decided as P0 step 3/4 in the capabilities roadmap).
    if (item.type === 'mcp' && !config.allow_mcp) continue;
    if (item.type === 'expert' && !config.allow_preset_switch) continue;

    const confidence = Math.max(0, Math.min(1, entry.confidence));
    if (confidence < config.confidence_threshold) continue;

    out.push({
      id,
      type: item.type,
      label: item.label,
      confidence,
      reason: typeof entry.reason === 'string' && entry.reason.trim()
        ? entry.reason.trim()
        : `可能适用于：${item.name}`,
    });
  }

  return out
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, config.max_suggestions);
};

/**
 * When the backend is unavailable / timed-out / returned unparseable JSON, fall
 * back to using the recalled items directly. Confidence is a fake monotonic
 * decay based on rank so the bar still feels ordered.
 */
export const fallbackFromRecall = (
  candidates: CapabilityItem[],
  config: CapabilityRoutingConfig = DEFAULT_CAPABILITY_ROUTING_CONFIG
): CapabilityDecision[] =>
  candidates.slice(0, config.max_suggestions).map((item, index) => ({
    id: item.id,
    type: item.type,
    label: item.label,
    confidence: Math.max(config.confidence_threshold, 0.85 - index * 0.1),
    reason: `与当前任务相关：${item.name}`,
  }));
