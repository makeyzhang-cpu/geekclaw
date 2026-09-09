/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * 智能能力路由（Auto Capability Routing）前端契约类型。
 *
 * 设计要点：
 * - 四类能力（技能 / MCP / 专家预设 / 插件）统一成 `CapabilityItem`，路由器只看这一层。
 * - 决策结果 `RouterDecision` 镜像后端 `POST /api/capability/route` 的响应结构，
 *   前端只做校验与展示，不信任任何未在候选集内出现的 id（防模型幻觉）。
 * - 所有配置经 `configKey capabilityRouting.config` 持久化，后端无 DB 迁移。
 */

/** 可被 AI 自动识别并挂载的能力类型。 */
export type CapabilityType = 'skill' | 'mcp' | 'preset' | 'plugin';

/** 统一能力条目：四类来源聚合后的形态。 */
export interface CapabilityItem {
  /** 全局唯一 id，形如 `skill:excel-report` / `mcp:github` / `preset:legal` / `plugin:xxx`。 */
  id: string;
  type: CapabilityType;
  /** 展示名。 */
  name: string;
  /** 供模型判断的摘要（≤220 字）。 */
  description: string;
  /** 领域/场景标签，用于召回打分（技能直接复用后端 scenario_tags / audience_tags）。 */
  tags: string[];
  /** 是否已安装/可用；false 时建议条展示「去安装」而非「挂载」。 */
  installed: boolean;
  /** 当前会话是否已挂载，用于幂等与去重。 */
  enabled: boolean;
  /** 各类型挂载所需参数，交由对应的挂载适配器消费。 */
  mount_payload: Record<string, unknown>;
}

/** 路由命中项（后端返回 + 前端校验后）。 */
export interface RouteCandidateRef {
  id: string;
  type: CapabilityType;
  /** 0~1，低于阈值丢弃。 */
  confidence: number;
  /** 展示给用户：为什么推荐。 */
  reason: string;
}

/** 后端 `POST /api/capability/route` 的响应结构。 */
export interface RouterDecision {
  need: RouteCandidateRef[];
  no_need: boolean;
}

/** 智能能力识别模式。suggest = 只建议不自动执行（默认，零误操作风险）。 */
export type CapabilityMode = 'off' | 'suggest' | 'auto';

/** 持久化配置（configKey `capabilityRouting.config`）。 */
export interface CapabilityRoutingConfig {
  mode: CapabilityMode;
  /** 置信度阈值，低于该值的命中项丢弃。 */
  confidence_threshold: number;
  /** 单次最多建议条数。 */
  max_suggestions: number;
  /** 是否允许建议 MCP（决策 3：即便允许也需逐次授权，不自动启用）。 */
  allow_mcp: boolean;
  /** 是否允许建议切换专家分身（决策 4：建议模式下需用户确认）。 */
  allow_preset_switch: boolean;
  /** 是否纳入市场未安装能力（决策 5：展示为「去安装」）。 */
  include_market: boolean;
}

/** 默认配置：建议模式 + 主会话模型路由。 */
export const DEFAULT_CAPABILITY_ROUTING_CONFIG: CapabilityRoutingConfig = {
  mode: 'suggest',
  confidence_threshold: 0.6,
  max_suggestions: 3,
  allow_mcp: true,
  allow_preset_switch: true,
  include_market: true,
};

/** 构造统一 id：`type:name`。 */
export const capabilityId = (type: CapabilityType, name: string): string => `${type}:${name}`;

/** 从统一 id 反解类型；不合法返回 undefined。 */
export const parseCapabilityType = (id: string): CapabilityType | undefined => {
  const prefix = id.slice(0, id.indexOf(':'));
  return prefix === 'skill' || prefix === 'mcp' || prefix === 'preset' || prefix === 'plugin' ? prefix : undefined;
};
