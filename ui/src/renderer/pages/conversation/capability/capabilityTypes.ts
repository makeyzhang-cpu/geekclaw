/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Capability-routing shared types. Single source of truth for both the
 * frontend registry and the /api/capability/route backend contract.
 *
 * Design rules:
 * - `type` is a fixed vocabulary (`skill` / `expert` / `mcp` / `plugin` /
 *   `market_install`); a backend change to the vocabulary is a breaking change
 *   for both ends.
 * - `id` is the only key the LLM is allowed to reference — anything else is
 *   treated as hallucination and dropped.
 * - `confidence` is the user-visible quality signal: 0 (irrelevant) … 1
 *   (definitely relevant).
 */

export type CapabilityType =
  | 'skill'
  | 'expert'
  | 'mcp'
  | 'plugin'
  | 'market_install';

/** A flattened in-memory capability, fed into both the recall stage and the
 *  backend prompt (the backend's `CapabilityCandidate`). */
export interface CapabilityItem {
  /** Stable id within the source market, e.g. `skill:browse-web-1`. The router
   *  uses this as the only allowed return key. */
  id: string;
  /** Localized label, copied into the response so the UI does not have to
   *  re-resolve the candidate. */
  label: string;
  /** Internal name/slug — used for tokenization. Not user-facing. */
  name: string;
  type: CapabilityType;
  /** Lower-cased scenario tags (e.g. `["browser","web","form-fill"]`). */
  tags: string[];
  /** Short description; also tokenized for recall. */
  description: string;
  /** True if the user already has this mounted locally. Already-mounted items
   *  are not suggested again (idempotency). */
  installed: boolean;
  /** Backend-specific payload, e.g. mcp server id, preset id, market
   *  package id. The mount-action helpers consume this verbatim. */
  payload?: Record<string, unknown>;
}

/** A single suggestion returned by the backend (or fallback). */
export interface CapabilityDecision {
  id: string;
  type: CapabilityType;
  label: string;
  /** 0..1, clamped on the response side. */
  confidence: number;
  /** Optional short rationale, ≤ 120 chars. */
  reason?: string;
}

export interface CapabilityRoutingConfig {
  /** When false the entire suggestion bar is hidden. */
  enabled: boolean;
  /** Hard cap on visible suggestions (also enforced server-side). */
  max_suggestions: number;
  /** Confidence floor, suggestions below are dropped. */
  confidence_threshold: number;
  /** Whether MCP servers can be suggested for mount (per user policy — needs
   *  explicit grant). */
  allow_mcp: boolean;
  /** Whether to suggest a preset/expert switch (per user policy). */
  allow_preset_switch: boolean;
  /** Whether to include market_install entries in recall + display. */
  include_market_in_suggestions: boolean;
  /** Bounded budget for the LLM call, in ms. */
  llm_timeout_ms: number;
}

export const DEFAULT_CAPABILITY_ROUTING_CONFIG: CapabilityRoutingConfig = {
  enabled: true,
  max_suggestions: 3,
  confidence_threshold: 0.6,
  allow_mcp: false,
  allow_preset_switch: true,
  include_market_in_suggestions: true,
  llm_timeout_ms: 8000,
};

/** Helper: convert a Candidate item into the `CapabilityCandidate` payload the
 *  backend expects on `/api/capability/route`. */
export const toBackendCandidate = (item: CapabilityItem) => ({
  id: item.id,
  label: item.label,
  type: item.type,
  hint: `${item.tags.join(' ')} ${item.description}`.trim().slice(0, 220),
});

/** Empty-state sentinel — never displayed, used while the hook is loading. */
export const EMPTY_DECISIONS: CapabilityDecision[] = [];
