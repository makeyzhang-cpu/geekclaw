/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * 协同共答（co-agent）前端契约类型。
 *
 * 这些类型**镜像**后端 `nomifun-ai-agent::co_agent` 的 `CoAgentConfig` /
 * `CoAgentResult` / `RunCoAgentRequest`，保持字段与 serde 命名一致
 * （snake_case，由 axios 默认 snake_case 序列化保证）。
 *
 * 设计要点：
 * - 配置（mode / keywords / name / 可选 provider/model）由前端拥有，经
 *   `POST /api/co-agent/run` 的请求体下发，后端**无 DB 迁移**。
 * - 渲染层复用既有 `IMessageText.agentMessage` / `senderName` 载体（多 Agent
 *   协作消息），无需新增消息类型。
 */

/** 梯度开关：协作者参与每轮对话的激进程度。 */
export type ICoAgentMode = 'off' | 'manual' | 'keyword' | 'auto';

/** 协作者运行配置，由设置页持久化（configKey `coAgent.config`）。 */
export interface ICoAgentConfig {
  /** 参与模式。默认 'auto'（与后端 Default 对齐）。 */
  mode: ICoAgentMode;
  /** 关键词触发模式下的触发词列表。 */
  keywords: string[];
  /** 协作者的系统提示。 */
  system_prompt: string;
  /** 可选显式 (provider_id, model)；为空时后端回落到系统默认 provider/key。 */
  provider_id: string;
  model: string;
  /** 协作者显示名（渲染在署名块中）。 */
  name: string;
  /** 喂给协作者的历史轮数（0 = 仅当前消息）。 */
  history_window: number;
}

/** 后端返回的一次协同结果（署名「协作者」块）。 */
export interface ICoAgentResult {
  name: string;
  answer: string;
  /** 协作者执行的工具调用（v1 为空，v1.5 策展插件 SDK 后才有）。 */
  tool_calls: string[];
}

/** `POST /api/co-agent/run` 请求体。 */
export interface IRunCoAgentRequest {
  config: ICoAgentConfig;
  message: string;
  history: string[];
}

/** 默认配置（与后端 `CoAgentConfig::default` 对齐）。 */
export const DEFAULT_CO_AGENT_CONFIG: ICoAgentConfig = {
  mode: 'auto',
  keywords: [],
  system_prompt:
    '你是 GeekClaw 的协同协作者。请基于用户的提问给出独立、有补充价值的见解或另一种解题思路，' +
    '语言风格与主助手保持一致，不重复已显而易见的结论。',
  provider_id: '',
  model: '',
  name: '协作者',
  history_window: 6,
};
