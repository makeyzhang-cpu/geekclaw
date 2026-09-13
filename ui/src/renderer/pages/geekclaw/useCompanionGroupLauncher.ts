/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// 数字员工圆桌群聊启动器（方案 A MVP）。
// 建群时把选中员工的人设合成进一个 Preset，由单个 LLM 分饰多角：
// 每位成员以「名字：」发言、@ 点名优先、无点名时按话题相关性 1-2 人接话。
// 真·互聊引擎（各员工独立会话互投消息）留待后端编排器（方案 B）。

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { ICompanionProfile } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';
import { useExpertConversationLauncher } from '@renderer/pages/expert-agents/useExpertConversationLauncher';

/** 成员人设文本：优先用户自定义 persona，其次通用描述。 */
const personaTextOf = (profile: ICompanionProfile): string => {
  const custom = profile.persona?.custom?.trim();
  return custom || '通用数字员工助手';
};

/** 合成圆桌群聊 system prompt：成员名册 + 发言规则。 */
export function composeCompanionGroupSystemPrompt(members: ICompanionProfile[]): string {
  const roster = members
    .map((m, index) => `${index + 1}. 「${m.name}」：${personaTextOf(m)}`)
    .join('\n');
  return [
    '你将主持一场数字员工圆桌群聊。请分饰以下多位数字员工，每位成员保持独立的人设、语气与立场：',
    roster,
    '## 发言规则',
    '- 每次只让一位成员发言，且必须以「成员名：」开头，例如「Mia：……」。',
    '- 用户以 @名字 点名时，由被点名的成员优先回应，其他成员可自然接话。',
    '- 没有点名时，选择与话题最相关的 1-2 位成员依次发言，不要全体轮番刷屏。',
    '- 成员之间可以有观点交锋与互相补充，但保持专业与友好。',
    '- 需要用户补充信息时，由最相关的成员直接提问。',
    '- 除群聊发言外，不要输出任何旁白、舞台指示或元说明。',
  ].join('\n\n');
}

/**
 * 圆桌群聊启动器：合成 Preset → 用统一 agent 会话链路建会话 → 跳转会话页。
 * Preset / 会话创建、默认模型解析与占位模型告警全部复用 useExpertConversationLauncher。
 */
export function useCompanionGroupLauncher() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { ensurePreset, ensureConversation } = useExpertConversationLauncher();

  const launchGroup = useCallback(
    async (members: ICompanionProfile[], groupName?: string): Promise<TChatConversation | null> => {
      if (members.length < 2) {
        Message.warning(t('geekclaw.group.needTwo', { defaultValue: '请至少选择两位员工' }));
        return null;
      }
      try {
        const fallbackName = `${members
          .map((m) => m.name)
          .join('、')} 的群聊`;
        const name = (groupName ?? '').trim() || fallbackName;
        const instructions = composeCompanionGroupSystemPrompt(members);
        const presetId = await ensurePreset(name, '数字员工圆桌群聊', instructions);
        if (!presetId) throw new Error('preset create failed');
        const conversation = await ensureConversation(name, presetId);
        if (conversation) {
          Message.success(t('geekclaw.group.launched', { defaultValue: '员工群聊已开启' }));
          void navigate(`/conversation/${conversation.id}`);
        }
        return conversation;
      } catch (error) {
        console.error('launch companion group failed:', error);
        Message.error(
          t('geekclaw.group.launchFailed', { defaultValue: '发起群聊失败，请稍后重试' })
        );
        return null;
      }
    },
    [ensureConversation, ensurePreset, navigate, t]
  );

  return { launchGroup };
}
