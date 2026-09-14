/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Left, LinkOut } from '@icon-park/react';
import { Message, Modal } from '@arco-design/web-react';
import { openExternalUrl } from '@/renderer/utils/platform';
import WebviewHost from '@renderer/components/media/WebviewHost';
import { useExpertIdentities } from '@renderer/pages/expert-agents/useExpertIdentities';
import { useExpertSkills } from '@renderer/pages/expert-agents/useExpertSkills';
import { useExpertConversationLauncher } from '@renderer/pages/expert-agents/useExpertConversationLauncher';
import {
  CollabMultiExpertModal,
  IdentityEditorModal,
  emptyIdentityDraft,
} from '@renderer/pages/expert-agents/expertEditors';
import type { IdentityEditorState } from '@renderer/pages/expert-agents/expertEditors';
import {
  EXPERT_TEAM_ID,
  composeMultiExpertSystemPrompt,
  isMarketingOpsIdentity,
  isMarketingOpsSkill,
  type ExpertIdentity,
  type ExpertSkill,
} from '@renderer/pages/expert-agents/data';
import type { TChatConversation } from '@/common/config/storage';
import { assignPersonFigures } from '@renderer/pages/companion/characters/builtinFigures';
import type { TeamHeroMember } from '@renderer/components/collaboration/TeamHero';
import ExpertRoster from './ExpertRoster';
import ExpertDesk from './ExpertDesk';
import SkillLibrary from './SkillLibrary';

/** GeekLink 专业外贸系统地址 */
const FOREIGN_TRADE_URL = 'https://niushitv.com/v2/';

/** 多专家协同的虚拟身份 id（不在名册里，只在选中期间存在）。 */
const TEAM_ID = EXPERT_TEAM_ID;

/**
 * ForeignTradePage — B2B外贸业务工作台。
 *
 * Restructured to mirror the 数字员工 surface: a roster sider (experts grouped
 * by category) plus an embedded desk that chats with the selected expert
 * in place — no route jump. The previous single entry card survives as a
 * standalone sider entry (below the skill library, visually separated) that
 * opens the GeekLink 专业外贸系统 in an in-app webview.
 *
 * 硬约束：本页所有会话行为（点专家、召唤专家组队、开技能对话、发消息）**全部页内完成**，
 * 任何情况下都不跳 /conversation 功能栏。为此新增两类「虚拟身份」：
 *   - `skill-<id>`：由单个技能合成的临时专家（技能库「开聊」）；
 *   - `__team__`   ：多专家协同小组（召唤专家多选后合成）。
 * 它们与真实专家共用同一个 ExpertDesk 会话栏，只是会话建立走多人 / 技能提示词。
 */
const ForeignTradePage: React.FC = () => {
  const { t } = useTranslation();
  const {
    identities,
    upsertIdentity,
    removeIdentity,
    createId: createIdentityId,
  } = useExpertIdentities();
  const {
    skills,
    upsertSkill,
    removeSkill,
    importSkills,
    exportSkills,
    createId: createSkillId,
    findSkill,
  } = useExpertSkills();
  const {
    launchToConversation,
    ensurePreset,
    ensureConversation: createConversation,
  } = useExpertConversationLauncher();

  // 归属过滤（2026-09-13 板块重组）：营销运营类的身份/技能移入
  // 「B2B外贸运营工作台」（/marketing-ops），本工作台只保留外贸履约/金融/
  // 客服/效能等部分。两页共享同一份 localStorage 数据，删除互通。
  const tradeIdentities = useMemo(
    () => identities.filter((item) => !isMarketingOpsIdentity(item)),
    [identities]
  );
  const tradeSkills = useMemo(() => skills.filter((item) => !isMarketingOpsSkill(item)), [skills]);

  // 名册级人物形象分配：左栏名册与右栏工作台头部取同一份结果，同一个人一张脸。
  const figureMap = useMemo(
    () => assignPersonFigures(tradeIdentities.map((item) => item.id || item.name)),
    [tradeIdentities]
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** expert id → its minted conversation. Kept here so switching experts back
   *  and forth reuses one session instead of creating a new one per click. */
  const [sessions, setSessions] = useState<Record<string, TChatConversation>>({});
  const [platformActive, setPlatformActive] = useState(false);
  /** Main pane: the expert desk, or the in-place skill library. */
  const [view, setView] = useState<'desk' | 'skills'>('desk');
  const [identityEditor, setIdentityEditor] = useState<IdentityEditorState>({
    open: false,
    mode: 'edit',
    draft: emptyIdentityDraft(''),
  });
  /** 多专家协同选择弹窗（原「协同办公」能力，已内联到本工作台） */
  const [multiExpertOpen, setMultiExpertOpen] = useState(false);
  const [multiSelected, setMultiSelected] = useState<string[]>([]);
  /** 技能合成 / 多专家协同的临时身份（不在名册里，只在其被选中期间存在）。 */
  const [virtualIdentity, setVirtualIdentity] = useState<ExpertIdentity | null>(null);
  /** 多专家协同的成员 id（合成系统提示词时用）。 */
  const [teamExpertIds, setTeamExpertIds] = useState<string[]>([]);

  // Land on the first expert so the desk is never a blank pane.
  useEffect(() => {
    if (!selectedId && tradeIdentities.length > 0) {
      setSelectedId(tradeIdentities[0].id);
    }
  }, [tradeIdentities, selectedId]);

  const selected: ExpertIdentity | null = useMemo(() => {
    const found = tradeIdentities.find((item) => item.id === selectedId) ?? null;
    if (found) return found;
    return virtualIdentity && virtualIdentity.id === selectedId ? virtualIdentity : null;
  }, [tradeIdentities, selectedId, virtualIdentity]);

  const ensureConversation = useCallback(async (): Promise<TChatConversation | null> => {
    if (!selected) return null;
    const cached = sessions[selected.id];
    if (cached) return cached;

    let conversation: TChatConversation | null = null;
    if (selected.id === TEAM_ID) {
      // 多专家协同：把各专家人格 + 关联技能合成一份系统提示词，用统一链路建会话。
      const members = tradeIdentities.filter((item) => teamExpertIds.includes(item.id));
      const allSkills: ExpertSkill[] = [];
      for (const expert of members) {
        for (const sid of expert.skillIds) {
          const skill = findSkill(sid);
          if (skill && !allSkills.includes(skill)) allSkills.push(skill);
        }
      }
      const instructions = composeMultiExpertSystemPrompt(members, allSkills);
      const presetId = await ensurePreset(selected.name, '多专家协同办公', instructions);
      if (!presetId) return null;
      conversation = await createConversation(selected.name, presetId);
    } else {
      const boundSkills = selected.skillIds
        .map(findSkill)
        .filter((s): s is ExpertSkill => Boolean(s));
      const fromSkill = selected.id.startsWith('skill-');
      conversation = await launchToConversation(selected, boundSkills, {
        persistPresetId: (id) => {
          if (id === selected.presetId) return;
          if (fromSkill) {
            // 技能合成的临时身份：preset 记回技能本身，绝不写一条假的专家记录。
            const skill = findSkill(selected.skillIds[0]);
            if (skill) upsertSkill({ ...skill, presetId: id });
            return;
          }
          upsertIdentity({ ...selected, presetId: id });
        },
      });
    }
    if (conversation) {
      setSessions((prev) => ({ ...prev, [selected.id]: conversation }));
    }
    return conversation;
  }, [
    createConversation,
    ensurePreset,
    findSkill,
    launchToConversation,
    selected,
    sessions,
    teamExpertIds,
    tradeIdentities,
    upsertIdentity,
    upsertSkill,
  ]);

  const openPlatform = useCallback(() => setPlatformActive(true), []);

  /** 在本页内切到某位专家（左栏名册与「一起工作」成员卡共用）。 */
  const selectIdentity = useCallback((id: string) => {
    setSelectedId(id);
    setView('desk');
  }, []);

  const identityCategories = useMemo(
    () => Array.from(new Set(tradeIdentities.map((item) => item.category))),
    [tradeIdentities]
  );

  /** 「一起工作」成员卡：本工作台的专家名册（含当前专家）。 */
  const teamMembers = useMemo<TeamHeroMember[]>(
    () =>
      tradeIdentities.map((item) => ({
        id: item.id,
        name: item.name,
        subtitle: item.category,
        figureSrc: figureMap.get(item.id || item.name)?.src,
        active: item.id === selectedId,
      })),
    [figureMap, selectedId, tradeIdentities]
  );

  // ── 专家身份 authoring ──
  // Inlined from 数字外贸团队 so the desk is self-contained: the same
  // IdentityEditorModal component backs both surfaces.
  const openIdentityCreate = () =>
    setIdentityEditor({ open: true, mode: 'create', draft: emptyIdentityDraft(createIdentityId()) });
  const openIdentityEdit = (item: ExpertIdentity) =>
    setIdentityEditor({ open: true, mode: 'edit', draft: item });
  const closeIdentityEditor = () => setIdentityEditor((prev) => ({ ...prev, open: false }));

  const handleIdentitySave = (item: ExpertIdentity) => {
    upsertIdentity(item);
    closeIdentityEditor();
    Message.success(item.name ? `已保存身份「${item.name}」` : '已保存');
  };

  const handleIdentityDelete = (item: ExpertIdentity) => {
    Modal.confirm({
      title: '删除专家身份',
      content: `确定删除「${item.name}」吗？该操作不可撤销。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { status: 'danger' },
      onOk: () => {
        removeIdentity(item.id);
        // Drop the cached session too, otherwise re-adding an identity with the
        // same id would resurrect a conversation bound to a deleted expert.
        setSessions((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        if (selectedId === item.id) setSelectedId(null);
        Message.success(`已删除身份「${item.name}」`);
      },
    });
  };

  // ── 专家技能 library ──
  const handleSkillSave = (item: ExpertSkill) => {
    upsertSkill(item);
  };

  const handleSkillDelete = (item: ExpertSkill) => {
    Modal.confirm({
      title: '删除专家技能',
      content: `确定删除技能「${item.name}」吗？绑定了该技能的专家身份会一并失去此能力。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { status: 'danger' },
      onOk: () => {
        removeSkill(item.id);
        Message.success(`已删除技能「${item.name}」`);
      },
    });
  };

  const handleSkillImport = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          if (!Array.isArray(parsed)) throw new Error('文件内容必须是技能对象数组');
          const count = importSkills(parsed as ExpertSkill[], 'merge');
          Message.success(`成功导入 ${count} 个技能（已按 id 合并）`);
        } catch (err) {
          Message.error(`导入失败：${err instanceof Error ? err.message : '未知错误'}`);
        }
      };
      reader.readAsText(file);
    },
    [importSkills]
  );

  const handleSkillExport = useCallback(() => {
    const blob = new Blob([exportSkills()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `geekclaw-skills-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    Message.success('技能库已导出');
  }, [exportSkills]);

  /**
   * 从单个技能开聊：合成一个临时专家身份并**切到工作台**（不跳会话页），
   * 首条消息发出时才真正建会话（见 ensureConversation）。
   */
  const handleLaunchSkill = useCallback((item: ExpertSkill) => {
    const synthetic: ExpertIdentity = {
      id: `skill-${item.id}`,
      name: item.name,
      category: item.category,
      description: item.description,
      icon: item.icon,
      skillIds: [item.id],
      presetId: item.presetId,
    };
    setVirtualIdentity(synthetic);
    setSelectedId(synthetic.id);
    setView('desk');
  }, []);

  /** 召唤多位专家组成协同小组：合成临时团队身份并在本页内打开。 */
  const handleLaunchMulti = useCallback(() => {
    const experts = tradeIdentities.filter((item) => multiSelected.includes(item.id));
    if (experts.length === 0) {
      Message.error('请至少选择一位专家');
      return;
    }
    setTeamExpertIds(experts.map((item) => item.id));
    setVirtualIdentity({
      id: TEAM_ID,
      name: t('foreignTrade.teamName', { defaultValue: '跨境外贸协同小组' }),
      category: t('foreignTrade.teamCategory', { defaultValue: '多专家协同' }),
      description: experts.map((item) => item.name).join('、'),
      icon: 'Peoples',
      skillIds: experts.flatMap((item) => item.skillIds),
    });
    setSelectedId(TEAM_ID);
    setView('desk');
    setMultiExpertOpen(false);
  }, [multiSelected, t, tradeIdentities]);

  // ── GeekLink 平台内嵌视图（左栏独立入口的下游）──
  if (platformActive) {
    return (
      <div className='w-full box-border px-12px md:px-24px py-24px'>
        <div className='mx-auto w-full md:max-w-1600px'>
          <div className='mb-12px flex items-center justify-between gap-8px'>
            <div className='flex items-center gap-8px'>
              <button
                onClick={() => setPlatformActive(false)}
                className='flex items-center gap-4px text-13px text-t-secondary hover:text-primary-6 cursor-pointer transition-colors'
              >
                <Left theme='outline' size='16' />
                {t('foreignTrade.back', { defaultValue: '返回' })}
              </button>
              <span className='text-14px font-600 text-t-primary'>
                {t('foreignTrade.cardTitle', { defaultValue: 'GeekLink 专业外贸系统' })}
              </span>
            </div>
            <button
              onClick={() => openExternalUrl(FOREIGN_TRADE_URL)}
              className='inline-flex items-center gap-6px px-12px py-6px text-12px font-500 text-primary-6 border border-primary-6 rounded-8px hover:bg-primary-1 cursor-pointer transition-colors'
            >
              <LinkOut theme='outline' size={14} />
              {t('foreignTrade.openExternal', { defaultValue: '在浏览器中打开' })}
            </button>
          </div>
          <div className='h-[calc(100vh-120px)] min-h-480px border border-[var(--color-border-2)] rounded-12px overflow-hidden bg-[var(--color-bg-2)]'>
            <WebviewHost key='foreign-trade' url={FOREIGN_TRADE_URL} showNavBar />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='w-full h-full min-h-0 flex'>
      <ExpertRoster
        identities={tradeIdentities}
        selectedId={selectedId}
        onSelect={(identity) => selectIdentity(identity.id)}
        onOpenPlatform={openPlatform}
        onOpenSkills={() => setView('skills')}
        onCreate={openIdentityCreate}
        onEdit={openIdentityEdit}
        onDelete={handleIdentityDelete}
        figureSrcOf={(seed) => figureMap.get(seed)?.src}
      />
      {view === 'skills' ? (
        <SkillLibrary
          skills={tradeSkills}
          createId={createSkillId}
          onSave={handleSkillSave}
          onDelete={handleSkillDelete}
          onLaunchSkill={handleLaunchSkill}
          onImport={handleSkillImport}
          onExport={handleSkillExport}
          onBack={() => setView('desk')}
        />
      ) : (
        <div className='flex-1 min-w-0 min-h-0 flex flex-col'>
          {selected ? (
            <ExpertDesk
              key={selected.id}
              identity={selected}
              conversation={sessions[selected.id] ?? null}
              onEnsureConversation={ensureConversation}
              onOpenPlatform={openPlatform}
              onOpenSkills={() => setView('skills')}
              onSummonExpert={() => setMultiExpertOpen(true)}
              figureSrc={figureMap.get(selected.id || selected.name)?.src}
              members={teamMembers}
              onSelectMember={selectIdentity}
              membersTitle={t('foreignTrade.membersTitle', {
                defaultValue: '本工作台专家 · 点卡片即可切换',
              })}
            />
          ) : (
            <div className='flex-1 flex flex-col items-center justify-center gap-12px px-24px text-center'>
              <span className='flex items-center justify-center size-64px rd-full bg-fill-2 text-primary-6'>
                <Globe theme='outline' size='28' fill='currentColor' />
              </span>
              <span className='text-15px font-500 text-t-primary'>
                {t('foreignTrade.emptyTitle', { defaultValue: '还没有外贸专家' })}
              </span>
              <span className='max-w-360px text-13px leading-20px text-t-tertiary'>
                {t('foreignTrade.emptyHint', {
                  defaultValue: '点击左栏「新建专家身份」创建专家，即可在这里与专家对话。',
                })}
              </span>
            </div>
          )}
        </div>
      )}

      <IdentityEditorModal
        visible={identityEditor.open}
        mode={identityEditor.mode}
        draft={identityEditor.draft}
        categories={identityCategories}
        skills={tradeSkills}
        onCancel={closeIdentityEditor}
        onSave={handleIdentitySave}
      />

      <CollabMultiExpertModal
        visible={multiExpertOpen}
        identities={tradeIdentities}
        selected={multiSelected}
        onChange={setMultiSelected}
        onCancel={() => setMultiExpertOpen(false)}
        onConfirm={handleLaunchMulti}
      />
    </div>
  );
};

export default ForeignTradePage;
