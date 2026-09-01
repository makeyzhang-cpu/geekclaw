/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// 极客出海 Agent —— 商业闭环启动器。
// 把"专家身份 / 专家技能 / 多专家组合"真正接进对话系统：运行时在后端创建一个
// Preset，将「人格 + 关联技能定义」写入 preset.instructions，再用该 preset_id 发起
// 真实会话（后端解析为不可变快照，注入系统提示词）。点击专家即可真的与这位专家对话。

import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import { Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { buildAgentConversationParams } from '@/common/utils/buildAgentConversationParams';
import { useModelsForTask } from '@/renderer/hooks/agent/useModelsForTask';
import { configService } from '@/common/config/configService';
import { emitter } from '@/renderer/utils/emitter';
import { seedConversationCache } from '@/renderer/pages/conversation/utils/conversationCache';
import {
  composeExpertSystemPrompt,
  composeMultiExpertSystemPrompt,
  type ExpertIdentity,
  type ExpertSkill,
} from './data';
import type { PresetTarget } from '@/common/types/agent/presetTypes';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import type { PresetId } from '@/common/types/ids';

type PersistPresetId = (presetId: string) => void;

/** Provider platform that supplies placeholder / local-only models and should
 *  not be chosen automatically for paid/production conversations. */
const FREE_MODEL_PLATFORM = 'geekclaw-free-model';

/** Build a unique key for a provider/model pair. */
const buildModelKey = (providerId?: string, modelName?: string) => {
  if (!providerId || !modelName) return null;
  return `${providerId}:${modelName}`;
};

/** Persisted default model shape, matching useGuidModelSelection. */
interface PersistedDefaultModel {
  provider_id: string;
  model: string;
}

function isPersistedDefaultModel(value: unknown): value is PersistedDefaultModel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  return typeof object.provider_id === 'string' && typeof object.model === 'string';
}

export function useExpertConversationLauncher() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { groups, isLoading: isModelsLoading } = useModelsForTask('chat');

  /** Resolve the best model to use for an expert-launched conversation.
   *  Prefer real configured providers (e.g. DeepSeek) over the placeholder
   *  GeekClaw Free Model, so the conversation actually responds. */
  const usableModel = useMemo((): TProviderWithModel | undefined => {
    if (isModelsLoading || groups.length === 0) return undefined;

    const isRealProvider = (provider: IProvider) =>
      provider.platform !== FREE_MODEL_PLATFORM && provider.api_key?.length > 0;

    const findGroupByProviderId = (providerId: string) =>
      groups.find((g) => g.provider.id === providerId);

    const buildProviderWithModel = (provider: IProvider, model: string): TProviderWithModel => ({
      ...provider,
      use_model: model,
    });

    // 1) Prefer the user's persisted default model if it points to a real provider.
    const rawSavedModel: unknown = configService.get('geekclaw.defaultModel');
    const savedModel = isPersistedDefaultModel(rawSavedModel) ? rawSavedModel : undefined;
    if (savedModel) {
      const group = findGroupByProviderId(savedModel.provider_id);
      if (group && group.models.includes(savedModel.model) && isRealProvider(group.provider)) {
        return buildProviderWithModel(group.provider, savedModel.model);
      }
    }

    // 2) Prefer the first real (non-free, API-key configured) provider/model.
    for (const group of groups) {
      if (isRealProvider(group.provider) && group.models.length > 0) {
        return buildProviderWithModel(group.provider, group.models[0]);
      }
    }

    // 3) Fallback to the first available model so the UI doesn't get stuck,
    //    but the caller should warn the user that it may not respond.
    const first = groups[0];
    if (first && first.models.length > 0) {
      return buildProviderWithModel(first.provider, first.models[0]);
    }

    return undefined;
  }, [groups, isModelsLoading]);

  const isUsingFallbackFreeModel = useMemo(() => {
    if (!usableModel) return false;
    return usableModel.platform === FREE_MODEL_PLATFORM;
  }, [usableModel]);

  /** 创建或更新后端 Preset，返回 preset_id。presetId 存在则尝试更新（编辑后即时反映），失败则回退新建。 */
  const ensurePreset = useCallback(
    async (
      name: string,
      description: string,
      instructions: string,
      presetId?: string
    ): Promise<string | undefined> => {
      const content = {
        name,
        description: description || undefined,
        instructions,
        instructions_i18n: { zh: instructions },
        targets: ['conversation'] as PresetTarget[],
        fallback_allowed: true,
        knowledge_policy: { enabled: false, mode: 'inherit', writeback: false, grounded: false },
        included_skills: [],
        excluded_auto_skills: [],
      };
      if (presetId) {
        try {
          const updated = await ipcBridge.presets.update.invoke({ preset_id: presetId as PresetId, ...content });
          return updated.preset_id;
        } catch {
          /* 预设可能已被用户在 /presets 删除，回退到新建 */
        }
      }
      const created = await ipcBridge.presets.create.invoke(content);
      return created.preset_id;
    },
    []
  );

  /** 用 preset_id 发起真实会话并跳转到会话页。 */
  const openConversation = useCallback(
    async (conversationName: string, presetId: string): Promise<boolean> => {
      if (isModelsLoading) {
        Message.warning(t('common.loading', { defaultValue: '模型列表加载中，请稍候' }));
        return false;
      }
      if (!usableModel) {
        Message.warning(
          t('conversation.noModelConfigured', { defaultValue: '请先在设置中配置默认模型' })
        );
        return false;
      }
      if (isUsingFallbackFreeModel) {
        Message.warning(
          t('expertAgentsHub.fallbackFreeModel', {
            defaultValue:
              '当前未配置可用的真实模型（如 DeepSeek），将使用占位模型，可能无法获得回复。请先到「模型管理」配置 API Key。',
          })
        );
      }
      const params = buildAgentConversationParams({
        backend: 'geekclaw',
        name: conversationName,
        preset_id: presetId as PresetId,
        workspace: '',
        model: usableModel,
        is_preset: true,
        extra: { workspace: '', custom_workspace: false, default_files: [] },
      });
      const conversation = await ipcBridge.conversation.create.invoke(params);
      if (!conversation || !conversation.id) {
        throw new Error('conversation create returned no id');
      }
      emitter.emit('chat.history.refresh');
      seedConversationCache(conversation);
      await navigate(`/conversation/${conversation.id}`);
      return true;
    },
    [usableModel, isModelsLoading, isUsingFallbackFreeModel, navigate, t]
  );

  /** 发起单个专家（或单技能合成的专家）对话。extraDirective 用于注入协同能力增强段。 */
  const launch = useCallback(
    async (
      identity: ExpertIdentity,
      skills: ExpertSkill[],
      opts?: { persistPresetId?: PersistPresetId; extraDirective?: string }
    ): Promise<boolean> => {
      try {
        const base = composeExpertSystemPrompt(identity, skills);
        const instructions = opts?.extraDirective
          ? `${base}\n\n${opts.extraDirective}`
          : base;
        const presetId = await ensurePreset(identity.name, identity.description, instructions, identity.presetId);
        if (!presetId) throw new Error('preset create failed');
        if (opts?.persistPresetId) opts.persistPresetId(presetId);
        const ok = await openConversation(identity.name, presetId);
        if (ok) {
          Message.success(
            t('expertAgentsHub.launched', { defaultValue: `已开启与「${identity.name}」的对话` })
          );
        }
        return ok;
      } catch (error) {
        console.error('launch expert conversation failed:', error);
        Message.error(
          t('expertAgentsHub.launchFailed', { defaultValue: '发起对话失败，请稍后重试' })
        );
        return false;
      }
    },
    [ensurePreset, openConversation, t]
  );

  /** 发起多专家协同对话（组合各专家人格 + 其技能）。extraDirective 用于注入协同能力增强段。 */
  const launchMulti = useCallback(
    async (
      experts: ExpertIdentity[],
      resolveSkill: (id: string) => ExpertSkill | undefined,
      extraDirective?: string
    ): Promise<boolean> => {
      try {
        const allSkills: ExpertSkill[] = [];
        for (const e of experts) {
          for (const sid of e.skillIds) {
            const s = resolveSkill(sid);
            if (s && !allSkills.includes(s)) allSkills.push(s);
          }
        }
        const base = composeMultiExpertSystemPrompt(experts, allSkills);
        const instructions = extraDirective ? `${base}\n\n${extraDirective}` : base;
        const presetId = await ensurePreset('跨境外贸协同小组', '多专家协同办公', instructions);
        if (!presetId) throw new Error('preset create failed');
        const ok = await openConversation('跨境外贸协同小组', presetId);
        if (ok) {
          Message.success(
            t('expertAgentsHub.multiLaunched', { defaultValue: '已开启多专家协同对话' })
          );
        }
        return ok;
      } catch (error) {
        console.error('launch multi expert conversation failed:', error);
        Message.error(
          t('expertAgentsHub.launchFailed', { defaultValue: '发起对话失败，请稍后重试' })
        );
        return false;
      }
    },
    [ensurePreset, openConversation, t]
  );

  return { launch, launchMulti, current_model: usableModel };
}
