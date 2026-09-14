/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// 数字员工圆桌群聊启动器（方案 A MVP）。
// 建群时把选中员工的人设合成进一个 Preset，由单个 LLM 分饰多角：
// 每位成员以「名字：」发言、@ 点名优先、无点名时按话题相关性 1-2 人接话。
// 真·互聊引擎（各员工独立会话互投消息）留待后端编排器（方案 B）。
//
// 人格合成逻辑已抽到零依赖的 `./groupPersona`，供会话页协作者面板共用。

import { useCallback } from 'react';
import { Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { ICompanionProfile } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';
import { useExpertConversationLauncher } from '@renderer/pages/expert-agents/useExpertConversationLauncher';
import { companionGroupNameOf, composeCompanionGroupSystemPrompt } from './groupPersona';

export { composeCompanionGroupSystemPrompt, companionGroupNameOf } from './groupPersona';

/**
 * 圆桌群聊启动器：合成 Preset → 用统一 agent 会话链路建会话。
 *
 * ⚠️ **不跳转**：只返回会话对象，由调用方在自己页面内就地渲染。
 * 群聊的发起入口（数字员工工作台「召唤伙伴」）必须全程留在本页 ——
 * 任何情况下都不进 /conversation 功能栏。
 * Preset / 会话创建、默认模型解析与占位模型告警全部复用 useExpertConversationLauncher。
 */
export function useCompanionGroupLauncher() {
  const { t } = useTranslation();
  const { ensurePreset, ensureConversation } = useExpertConversationLauncher();

  const launchGroup = useCallback(
    async (members: ICompanionProfile[], groupName?: string): Promise<TChatConversation | null> => {
      if (members.length < 2) {
        Message.warning(t('geekclaw.group.needTwo', { defaultValue: '请至少选择两位员工' }));
        return null;
      }
      try {
        const name = (groupName ?? '').trim() || companionGroupNameOf(members);
        const instructions = composeCompanionGroupSystemPrompt(members);
        const presetId = await ensurePreset(name, '数字员工圆桌群聊', instructions);
        if (!presetId) throw new Error('preset create failed');
        const conversation = await ensureConversation(name, presetId);
        if (conversation) {
          Message.success(t('geekclaw.group.launched', { defaultValue: '员工群聊已开启' }));
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
    [ensureConversation, ensurePreset, t]
  );

  return { launchGroup };
}
