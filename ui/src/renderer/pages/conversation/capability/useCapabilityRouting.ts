/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * `useCapabilityRouting` — derived-state hook.
 *
 * The hook is purely *derived*: pass in the current message (and optional
 * recent history), pass in the live capability registry, and you get a list
 * of `CapabilityDecision` objects to render. We do not own the message buffer
 * ourselves — the composer owns it. This makes the hook idempotent and
 * re-entrancy-safe, and means debouncing is the composer's responsibility
 * (not ours) so we never race ourselves.
 *
 * Failure model (intentional):
 *   - disabled config / empty registry / short message → []
 *   - LLM call rejected / timed out / unparseable     → fallback to recall-only
 * The bar never blocks the main chat turn.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { capabilityRoute, type ICapabilityDecision } from '@/common/adapter/ipcBridge';

import { recallCandidates, fallbackFromRecall, validateDecision } from './capabilityRouter';
import {
  DEFAULT_CAPABILITY_ROUTING_CONFIG,
  EMPTY_DECISIONS,
  toBackendCandidate,
  type CapabilityDecision,
  type CapabilityItem,
  type CapabilityRoutingConfig,
} from './capabilityTypes';

const REQUEST_TIMEOUT_MS = 8000;

export interface UseCapabilityRoutingInput {
  registry: CapabilityItem[];
  message: string;
  history?: string[];
  config?: CapabilityRoutingConfig;
}

export interface UseCapabilityRoutingResult {
  decisions: ReadonlyArray<CapabilityDecision>;
  loading: boolean;
  source: 'idle' | 'pending' | 'backend' | 'recall-fallback';
}

const fromBackendShape = (raw: ICapabilityDecision[]): CapabilityDecision[] =>
  raw.map((d) => ({
    id: d.id,
    type: d.type,
    label: d.label,
    confidence: typeof d.confidence === 'number' ? d.confidence : 0,
    reason: d.reason ?? '',
  }));

/**
 * Run the routing pipeline for a given message + registry snapshot. Pure
 * (no React state), so it is also handy in tests or non-React code paths.
 */
export const routeOnce = async (
  input: UseCapabilityRoutingInput,
  signal?: AbortSignal
): Promise<UseCapabilityRoutingResult> => {
  const cfg = input.config ?? DEFAULT_CAPABILITY_ROUTING_CONFIG;
  if (!cfg.enabled) return { decisions: [], loading: false, source: 'idle' };
  if (input.registry.length === 0)
    return { decisions: [], loading: false, source: 'idle' };

  const trimmed = input.message.trim().slice(0, 500);
  if (trimmed.length < 4) return { decisions: [], loading: false, source: 'idle' };

  const recalled = recallCandidates(input.registry, trimmed, input.history ?? [], {
    includeMarket: cfg.include_market_in_suggestions,
  });
  if (recalled.length === 0) return { decisions: [], loading: false, source: 'idle' };

  const deadline = Date.now() + REQUEST_TIMEOUT_MS;

  try {
    const invokeP = capabilityRoute.invoke({
      message: trimmed,
      candidates: recalled.map(toBackendCandidate),
      max_suggestions: cfg.max_suggestions,
      threshold: cfg.confidence_threshold,
    });
    const timeoutP = new Promise<never>((_resolve, reject) =>
      window.setTimeout(() => reject(new Error('capability-route timeout')), REQUEST_TIMEOUT_MS)
    );
    if (signal?.aborted) throw new Error('aborted');
    const raw = (await Promise.race([invokeP, timeoutP])) as ICapabilityDecision[] | null;
    if (signal?.aborted) throw new Error('aborted');

    const validated = validateDecision(raw ?? [], recalled, cfg);
    if (validated.length > 0) return { decisions: validated, loading: false, source: 'backend' };
    const fallback = fallbackFromRecall(recalled, cfg);
    return { decisions: fallback, loading: false, source: 'recall-fallback' };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[capability] backend unavailable, using recall fallback:', error);
    if (Date.now() >= deadline || (error instanceof Error && error.message === 'aborted')) {
      return { decisions: fallbackFromRecall(recalled, cfg), loading: false, source: 'recall-fallback' };
    }
    return { decisions: fallbackFromRecall(recalled, cfg), loading: false, source: 'recall-fallback' };
  }
};

export const useCapabilityRouting = (
  input: UseCapabilityRoutingInput
): UseCapabilityRoutingResult => {
  const cfg = input.config ?? DEFAULT_CAPABILITY_ROUTING_CONFIG;
  const [state, setState] = useState<UseCapabilityRoutingResult>({
    decisions: EMPTY_DECISIONS,
    loading: false,
    source: 'idle',
  });
  // Latest-ref pattern: every render we update `latest.current`; the effect
  // closure can thus read live values without re-subscribing on every change.
  const latest = useRef(input);
  latest.current = input;

  const run = useCallback(
    async (signal: AbortSignal) => {
      const result = await routeOnce(latest.current, signal);
      if (!signal.aborted) setState(result);
    },
    []
  );

  useEffect(() => {
    if (!cfg.enabled || input.registry.length === 0) {
      setState({ decisions: EMPTY_DECISIONS, loading: false, source: 'idle' });
      return;
    }
    const trimmed = input.message.trim().slice(0, 500);
    if (trimmed.length < 4) {
      setState({ decisions: EMPTY_DECISIONS, loading: false, source: 'idle' });
      return;
    }

    const ac = new AbortController();
    setState((prev) => ({ decisions: prev.decisions, loading: true, source: 'pending' }));
    run(ac.signal);
    return () => ac.abort();
    // We intentionally depend on message identity (trim-then-slice-500),
    // registry ref equality, history, and config — every upstream change that
    // can shift the routing result triggers a re-run, and nothing else does.
  }, [cfg, run, input.message, input.registry, input.history]);

  return state;
};
