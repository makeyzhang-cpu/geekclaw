/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
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
import type { ExpertIdentity, ExpertSkill } from '@renderer/pages/expert-agents/data';
import type { TChatConversation } from '@/common/config/storage';
import ExpertRoster from './ExpertRoster';
import ExpertDesk from './ExpertDesk';
import SkillLibrary from './SkillLibrary';

/** GeekLink 外贸平台地址 */
const FOREIGN_TRADE_URL = 'https://niushitv.com/v2/';

/**
 * ForeignTradePage — B2B 外贸工作台。
 *
 * Restructured to mirror the 数字员工 surface: a roster sider (experts grouped
 * by category) plus an embedded desk that chats with the selected expert
 * in place — no route jump. The previous single entry card survives as a
 * standalone sider entry (below the skill library, visually separated) that
 * opens the GeekLink platform in an in-app webview.
 */
const ForeignTradePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
  const { launch, launchMulti, launchToConversation } = useExpertConversationLauncher();

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

  // Land on the first expert so the desk is never a blank pane.
  useEffect(() => {
    if (!selectedId && identities.length > 0) {
      setSelectedId(identities[0].id);
    }
  }, [identities, selectedId]);

  const selected: ExpertIdentity | null = useMemo(
    () => identities.find((item) => item.id === selectedId) ?? null,
    [identities, selectedId]
  );

  const ensureConversation = useCallback(async (): Promise<TChatConversation | null> => {
    if (!selected) return null;
    const cached = sessions[selected.id];
    if (cached) return cached;
    const skills = selected.skillIds
      .map(findSkill)
      .filter((s): s is ExpertSkill => Boolean(s));
    const conversation = await launchToConversation(selected, skills, {
      persistPresetId: (id) => {
        if (id !== selected.presetId) upsertIdentity({ ...selected, presetId: id });
      },
    });
    if (conversation) {
      setSessions((prev) => ({ ...prev, [selected.id]: conversation }));
    }
    return conversation;
  }, [findSkill, launchToConversation, selected, sessions, upsertIdentity]);

  const openConversationPage = useCallback(() => {
    if (!selected) return;
    const cached = sessions[selected.id];
    if (cached) {
      void navigate(`/conversation/${cached.id}`);
      return;
    }
    void ensureConversation().then((conversation) => {
      if (conversation) void navigate(`/conversation/${conversation.id}`);
    });
  }, [ensureConversation, navigate, selected, sessions]);

  const openPlatform = useCallback(() => setPlatformActive(true), []);

  const identityCategories = useMemo(
    () => Array.from(new Set(identities.map((item) => item.category))),
    [identities]
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

  /** Start a conversation from a single skill (wrapped in a synthetic identity). */
  const handleLaunchSkill = useCallback(
    (item: ExpertSkill) => {
      const synthetic: ExpertIdentity = {
        id: `skill-${item.id}`,
        name: item.name,
        category: item.category,
        description: item.description,
        icon: item.icon,
        skillIds: [item.id],
      };
      launch(synthetic, [item], {
        persistPresetId: (id) => {
          if (id !== item.presetId) upsertSkill({ ...item, presetId: id });
        },
      });
    },
    [launch, upsertSkill]
  );

  const handleLaunchMulti = useCallback(() => {
    const experts = identities.filter((item) => multiSelected.includes(item.id));
    if (experts.length === 0) {
      Message.error('请至少选择一位专家');
      return;
    }
    launchMulti(experts, findSkill);
    setMultiExpertOpen(false);
  }, [findSkill, identities, launchMulti, multiSelected]);

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
                {t('foreignTrade.cardTitle', { defaultValue: 'GeekLink 外贸平台' })}
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
        identities={identities}
        selectedId={selectedId}
        onSelect={(identity) => {
          setSelectedId(identity.id);
          setView('desk');
        }}
        onOpenPlatform={openPlatform}
        onOpenSkills={() => setView('skills')}
        onCreate={openIdentityCreate}
        onEdit={openIdentityEdit}
        onDelete={handleIdentityDelete}
      />
      {view === 'skills' ? (
        <SkillLibrary
          skills={skills}
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
              onOpenConversationPage={openConversationPage}
              onOpenPlatform={openPlatform}
              onOpenSkills={() => setView('skills')}
              onSummonExpert={() => setMultiExpertOpen(true)}
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
        skills={skills}
        onCancel={closeIdentityEditor}
        onSave={handleIdentitySave}
      />

      <CollabMultiExpertModal
        visible={multiExpertOpen}
        identities={identities}
        selected={multiSelected}
        onChange={setMultiSelected}
        onCancel={() => setMultiExpertOpen(false)}
        onConfirm={handleLaunchMulti}
      />
    </div>
  );
};

export default ForeignTradePage;
