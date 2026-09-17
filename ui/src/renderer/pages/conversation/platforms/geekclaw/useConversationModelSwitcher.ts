/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// 会话「换服务商 + 换模型」的统一落地点。
//
// 背景（2026-09-17 用户要求）：会话页 / 数字员工 / B2B 外贸运营工作台 /
// B2B 外贸业务工作台 …… 每一处会话框都必须在**开局就能选**服务商与模型，
// 并且**会话中途随时能换**。此前只有 /conversation 的全功能会话页接了真实
// 换模型链路，内嵌工作台一律 `lockedSelect`（空操作）+ 隐藏选择器。
//
// 🔴 换模型**必须同时写 `execution_model_pool`**：网关侧
// `caps_agent_execution.rs` 是
//     if let Some(pool) = conversation.execution_model_pool.clone() { pool }
//     else if let Some(model) = conversation.model.as_ref() { Single { model } }
// 即**池优先于 model**。只改 `model` 不改池，界面会显示新模型、真实执行仍跑旧模型
// —— 一个只有用户能发现的假象。

import { useCallback } from 'react';
import { Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { ConversationId } from '@/common/types/ids';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import type { TExecutionModelPool, TExecutionModelRef } from '@/common/types/agentExecution/agentExecutionTypes';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { saveNomiDefaultModel } from '@/renderer/pages/guid/hooks/agentSelectionUtils';

/**
 * 把「主模型换成 `lead`」落到执行模型池上，**保留协作者**。
 *
 * 行上原本是 range 池时，把主模型（第 0 位）换成新模型、其余协作者按原顺序保留
 * （新模型若已在协作者里则去重）；其余情况（single / automatic / 无池）统一收敛成
 * 单模型池 —— `automatic` 表示「交给后端自动选」，用户一旦显式指定模型就不该再自动。
 */
export function rebuildExecutionModelPool(
  pool: TExecutionModelPool | null | undefined,
  lead: TExecutionModelRef,
): TExecutionModelPool {
  if (pool?.mode !== 'range') return { mode: 'single', model: lead };
  const rest = pool.models
    .slice(1)
    .filter((item) => !(item.provider_id === lead.provider_id && item.model === lead.model));
  const models: TExecutionModelRef[] = [lead, ...rest];
  return models.length === 1 ? { mode: 'single', model: models[0] } : { mode: 'range', models };
}

/**
 * 把一个具体会话行的主模型换成 `provider` + `modelName`。
 *
 * 独立成纯函数（而不是只藏在 hook 里），是因为「会话栏里先选好模型、首条消息才建会话」
 * 这条路径拿到会话 id 的时刻晚于组件挂载 —— 那时 hook 的 `conversationId` 还没定，
 * 却必须在下发首条消息**之前**把模型写好（见 ExpertDesk 的 hero 预选）。
 */
export async function applyConversationModel(
  conversationId: ConversationId,
  provider: Pick<IProvider, 'id'>,
  modelName: string,
): Promise<boolean> {
  const selected = { ...provider, use_model: modelName } as TProviderWithModel;

  // 运行中的 agent 绑的是旧模型，下一条消息才会用新模型重建 —— 先停掉，
  // 否则用户会看到「换了模型但回答还是旧模型」。
  try {
    await ipcBridge.conversation.stop.invoke({ conversation_id: conversationId });
  } catch {
    // 没有运行中的任务时 stop 会失败；这与换模型无关，不阻断。
  }

  // 池优先于 model（见文件头）：必须读**最新**的行状态来保留协作者，
  // 不能依赖调用方可能已经过期的 conversation props。
  let pool: TExecutionModelPool | null = null;
  try {
    const latest = await getConversationOrNull(conversationId);
    pool = latest?.execution_model_pool ?? null;
  } catch {
    // 读不到就退化为单模型池 —— 总好过留着带旧主模型的池。
  }

  const ok = await ipcBridge.conversation.update.invoke({
    conversation_id: conversationId,
    updates: {
      model: selected,
      execution_model_pool: rebuildExecutionModelPool(pool, {
        provider_id: provider.id,
        model: modelName,
      }),
    },
  });
  if (!ok) return false;

  // 记住用户偏好，供 Guid 页 / 专家启动器下次开局使用（best-effort，不阻断）。
  void saveNomiDefaultModel(provider.id, modelName);
  return true;
}

export type ConversationModelSwitcherOptions = {
  /** 目标会话；缺席（尚未建会话）时不动作。 */
  conversationId: string | null | undefined;
  /**
   * 「数字员工」面：模型是**员工的全局属性**（`profile.model` 是唯一事实源，
   * 后端 `patch_companion` 会把它同步回会话行并清空 IM 渠道会话）。
   * 不回调这里的话，发送框和头部 CompanionModelControl 会显示两个矛盾的模型，
   * 且下一次 patch 会把这里的改动悄悄回滚。
   *
   * ⚠️ 员工**群聊**会话不是该员工的专属会话，群聊态必须传 undefined。
   *
   * 返回值只需可 `await`（`patchCompanion` 会返回新的 profile，这里不关心）。
   */
  onCompanionModelChange?: (provider: IProvider, modelName: string) => unknown;
};

/**
 * 内嵌会话面（数字员工 / 专家工作台）可直接喂给 `useNomiModelSelection` 的
 * `onSelectModel`。
 */
export const useConversationModelSwitcher = ({
  conversationId,
  onCompanionModelChange,
}: ConversationModelSwitcherOptions): ((provider: IProvider, modelName: string) => Promise<boolean>) => {
  const { t } = useTranslation();

  return useCallback(
    async (provider: IProvider, modelName: string): Promise<boolean> => {
      if (!conversationId) return false;
      try {
        const applied = await applyConversationModel(conversationId as ConversationId, provider, modelName);
        if (!applied) return false;
      } catch (error) {
        console.error('[conversation] switch model failed', error);
        Message.error(
          (error as Error)?.message ||
            t('conversation.chat.modelSwitchFailed', { defaultValue: '切换模型失败，请重试' }),
        );
        return false;
      }
      // 员工面：先落 profile（唯一事实源），再让发送框显示新模型。
      if (onCompanionModelChange) {
        try {
          await onCompanionModelChange(provider, modelName);
        } catch (error) {
          console.error('[conversation] sync companion model failed', error);
          Message.error(
            (error as Error)?.message ||
              t('geekclaw.chat.modelSwitchFailed', { defaultValue: '保存员工模型失败，请重试' }),
          );
          return false;
        }
      }
      return true;
    },
    [conversationId, onCompanionModelChange, t],
  );
};
