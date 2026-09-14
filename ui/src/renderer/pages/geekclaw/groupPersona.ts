/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// 数字员工「团队人格」合成 —— 纯函数，零依赖（只依赖 profile 类型）。
//
// 拆成独立模块是为了让**会话页的协作者面板**也能引用它合成团队人格，
// 而不必牵连 `useCompanionGroupLauncher` 的 hook / 路由依赖链。

import type { ICompanionProfile } from '@/common/adapter/ipcBridge';

/** 成员人设文本：优先用户自定义 persona，其次通用描述。 */
const personaTextOf = (profile: ICompanionProfile): string => {
  const custom = profile.persona?.custom?.trim();
  return custom || '通用数字员工助手';
};

/** 团队成员名册行（`1. 「名字」：人设`）。 */
const rosterOf = (members: ICompanionProfile[]): string =>
  members.map((m, index) => `${index + 1}. 「${m.name}」：${personaTextOf(m)}`).join('\n');

/** 合成圆桌群聊 system prompt：成员名册 + 发言规则。 */
export function composeCompanionGroupSystemPrompt(members: ICompanionProfile[]): string {
  return [
    '你将主持一场数字员工圆桌群聊。请分饰以下多位数字员工，每位成员保持独立的人设、语气与立场：',
    rosterOf(members),
    '## 发言规则',
    '- 每次只让一位成员发言，且必须以「成员名：」开头，例如「Mia：……」。',
    '- 用户以 @名字 点名时，由被点名的成员优先回应，其他成员可自然接话。',
    '- 没有点名时，选择与话题最相关的 1-2 位成员依次发言，不要全体轮番刷屏。',
    '- 成员之间可以有观点交锋与互相补充，但保持专业与友好。',
    '- 需要用户补充信息时，由最相关的成员直接提问。',
    '- 除群聊发言外，不要输出任何旁白、舞台指示或元说明。',
  ].join('\n\n');
}

/** 默认团队名（未显式命名时按成员自动生成）。 */
export const companionGroupNameOf = (members: ICompanionProfile[]): string =>
  members.length > 0 ? `${members.map((m) => m.name).join('、')} 的群聊` : '数字员工团队';
