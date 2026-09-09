/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * 能力路由器：本地召回 + 决策解析校验（纯函数，易单测、不依赖 UI）。
 *
 * 两段式设计（先召回后决策，避免把全量能力塞进 prompt）：
 *   1) `recallCandidates`  本地按标签/关键词打分，取 Top-K；
 *   2) `parseRouteDecision` 校验模型返回的结构化决策，越权 id 一律丢弃。
 *
 * 降级策略：模型不可用 / 返回非法 JSON 时，用召回结果直接展示建议
 * （`fallbackFromRecall`），保证「没有模型也能给建议」，绝不阻塞主对话。
 */

import {
  DEFAULT_CAPABILITY_ROUTING_CONFIG,
  type CapabilityItem,
  type CapabilityRoutingConfig,
  type RouteCandidateRef,
  type RouterDecision,
} from './capabilityTypes';

/** 把用户消息切成可用于匹配的词：英文按空格，中文取 2~4 字滑动窗口。 */
const tokenize = (text: string): string[] => {
  const normalized = text.toLowerCase();
  const words = normalized
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
  const tokens = new Set<string>(words);

  // 中文无空格，取 2-gram 作为粗粒度特征（成本低、召回够用）。
  const cjk = normalized.replace(/[^\p{Script=Han}]+/gu, '');
  for (let i = 0; i + 2 <= cjk.length; i += 1) tokens.add(cjk.slice(i, i + 2));
  return [...tokens];
};

/** 单个能力的召回打分：标签命中权重最高，其次名称、描述。 */
const scoreCapability = (item: CapabilityItem, tokens: string[]): number => {
  if (item.enabled) return -1; // 已挂载的能力不重复建议（幂等）
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
  /** 返回候选上限（默认 8，给模型判断用；最终建议条再按 max_suggestions 截断）。 */
  limit?: number;
  /** 是否纳入未安装能力（市场项）。 */
  includeMarket?: boolean;
}

/**
 * 本地召回 Top-K 候选。返回打分大于 0 的条目，按分数降序。
 */
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

/** 从模型输出中提取首个 JSON 对象（模型常夹带解释文字，需容错）。 */
const extractJson = (raw: string): unknown | undefined => {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return undefined;
  }
};

/**
 * 校验模型决策：只保留候选集内、且置信度达标的命中项。
 * 任何异常（非法 JSON / 字段缺失 / 越权 id）都返回空数组，由调用方静默降级。
 */
export const parseRouteDecision = (
  raw: string,
  candidates: CapabilityItem[],
  config: CapabilityRoutingConfig = DEFAULT_CAPABILITY_ROUTING_CONFIG
): RouteCandidateRef[] => {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') return [];

  const data = parsed as { need?: unknown; no_need?: unknown };
  if (data.no_need === true || !Array.isArray(data.need)) return [];

  const allowed = new Map(candidates.map((item) => [item.id, item]));
  const result: RouteCandidateRef[] = [];

  data.need.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const e = entry as { id?: unknown; type?: unknown; confidence?: unknown; reason?: unknown };
    const id = typeof e.id === 'string' ? e.id : '';
    const item = allowed.get(id);
    if (!item) return; // 越权/幻觉 id，直接丢弃

    const confidence = typeof e.confidence === 'number' ? e.confidence : Number(e.confidence);
    if (!Number.isFinite(confidence) || confidence < config.confidence_threshold) return;

    // 类型过滤：MCP 与专家切换由配置独立控制（决策 3 / 决策 4）。
    if (item.type === 'mcp' && !config.allow_mcp) return;
    if (item.type === 'preset' && !config.allow_preset_switch) return;

    result.push({
      id: item.id,
      type: item.type,
      confidence,
      reason: typeof e.reason === 'string' && e.reason.trim() ? e.reason.trim() : `可能适用于：${item.name}`,
    });
  });

  return result
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, config.max_suggestions);
};

/** 模型不可用时的降级：直接用本地召回结果构造建议（置信度按排名递减）。 */
export const fallbackFromRecall = (
  candidates: CapabilityItem[],
  config: CapabilityRoutingConfig = DEFAULT_CAPABILITY_ROUTING_CONFIG
): RouteCandidateRef[] =>
  candidates.slice(0, config.max_suggestions).map((item, index) => ({
    id: item.id,
    type: item.type,
    confidence: Math.max(config.confidence_threshold, 0.9 - index * 0.1),
    reason: `与当前任务相关：${item.name}`,
  }));

/** 把后端返回的决策对象（已解析）走同一套校验，做双保险。 */
export const validateDecision = (
  decision: RouterDecision | null | undefined,
  candidates: CapabilityItem[],
  config: CapabilityRoutingConfig = DEFAULT_CAPABILITY_ROUTING_CONFIG
): RouteCandidateRef[] => {
  if (!decision || decision.no_need || !Array.isArray(decision.need)) return [];
  return parseRouteDecision(JSON.stringify(decision), candidates, config);
};
