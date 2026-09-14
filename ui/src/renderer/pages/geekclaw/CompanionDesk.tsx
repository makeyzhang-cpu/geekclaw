/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Message, Spin } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import { uuidv7 } from '@/common/utils';
import type { TChatConversation } from '@/common/config/storage';
import type { ConversationId, CompanionId } from '@/common/types/ids';
import CompanionAvatar from '@renderer/pages/companion/CompanionAvatar';
import { customFigureMetaOf } from '@renderer/pages/companion/characters/customMeta';
import type { CompanionMood } from '@renderer/pages/companion/characters';
import NomiChat from '@renderer/pages/conversation/platforms/geekclaw/NomiChat';
import { useNomiModelSelection } from '@renderer/pages/conversation/platforms/geekclaw/useNomiModelSelection';
import { PreviewProvider } from '@renderer/pages/conversation/Preview';
import { getConversationOrNull } from '@renderer/pages/conversation/utils/conversationCache';
import TeamHero from '@renderer/components/collaboration/TeamHero';
import type { TeamHeroMember } from '@renderer/components/collaboration/TeamHero';
import { browserStorageKey } from '@/common/utils/browserStorageKey';
import { emitter } from '@renderer/utils/emitter';
import CompanionModelControl from './CompanionModelControl';
import CompanionGroupModal from './CompanionGroupModal';
import { useCompanionGroupLauncher } from './useCompanionGroupLauncher';
import type { ICompanionProfile, ICompanionWithStatus } from '@/common/adapter/ipcBridge';
import type { CompanionHandle, WorkspaceTabKey } from './workspace/types';

type NomiConversation = Extract<TChatConversation, { type: 'geekclaw' }>;

interface CompanionDeskProps {
  companion: CompanionHandle;
  /** Roster for the group-chat picker AND the「一起工作」成员卡（页面级 useCompanions 结果）。 */
  companions: ICompanionWithStatus[];
  companionsLoading?: boolean;
  /** Open the settings workspace on the given tab. */
  onOpenSettings: (tab: WorkspaceTabKey) => void;
  /**
   * 在本页内切到另一位员工 —— 「一起工作」成员卡点击走这里。
   * ⚠️ 硬约束：不得跳转到 /conversation 功能栏，切换由页面在自身 URL 上完成。
   */
  onSelectCompanion: (id: CompanionId) => void;
}

/**
 * 该员工的会话里是否真的已经有过至少一轮消息？
 *
 * 后端有两处会「凭空」铸出一个空的员工会话，它们都不代表用户聊过天：
 *   1. `CompanionService::create_companion` —— 建员工时若已配好模型，直接建会话；
 *   2. 任何走 `ensureCompanionSession` 的入口 —— 会话侧栏的员工分组点击等。
 * 这种空壳必须继续停在设计好的 hero 卡片上：chat 分支渲染的是 NomiChat 的空会话，
 * 画面就是一大片空白 —— 既没有会话栏，也没有成员卡片。
 *
 * 探测失败按「有消息」处理，避免把真有记录的员工误降级回 hero 卡片。
 */
const sessionHasTurns = async (conversationId: ConversationId): Promise<boolean> => {
  try {
    const page = await ipcBridge.database.getConversationMessages.invoke({
      conversation_id: conversationId,
      page: 0,
      page_size: 1,
      content_mode: 'compact',
    });
    return (page?.items?.length ?? 0) > 0;
  } catch {
    return true;
  }
};

/**
 * 员工工作台 — the landing surface when a companion is picked from the roster.
 *
 * This is a *real* chat surface, not a launchpad: the companion's canonical
 * session is embedded through `NomiChat`, so the desk renders the full
 * transcript (tool cards / thinking / artifacts / Markdown) and accepts turns
 * in place — no route jump into /conversation/:id.
 *
 * Two phases:
 *  - **hero** — no session yet, the session row vanished, OR the session is still
 *    empty (minted by the backend at creation / by an `ensure*` navigation and
 *    never used). Renders the「与 X 一起工作」会话栏（TeamHero）：标题 + 头像组 +
 *    大输入框 + 横排员工卡片。首次发送复用/铸造专属会话，切到 `chat`，**然后**
 *    才投递消息，保证 `NomiChat` 的流式订阅已经就绪。
 *  - **chat** — embedded `NomiChat` over a session that already holds turns
 *    (单人会话或圆桌群聊会话共用这一分支)。
 *
 * 硬约束：所有入口都是**页内行为** —— 成员卡切人、召唤伙伴组群聊、使用 Skills、
 * 发消息，全部在当前页面完成，任何情况下都不跳 /conversation 功能栏。
 */
const CompanionDesk: React.FC<CompanionDeskProps> = ({
  companion,
  companions,
  companionsLoading = false,
  onOpenSettings,
  onSelectCompanion,
}) => {
  const { t } = useTranslation();
  const { profile, status } = companion;
  const companionId = profile?.companion_id ?? null;

  const [sessionId, setSessionId] = useState<ConversationId | null>(null);
  const [conversation, setConversation] = useState<NomiConversation | null>(null);
  const [phase, setPhase] = useState<'hero' | 'chat'>('hero');
  const [booting, setBooting] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  /** Text to dispatch once the embedded chat surface has mounted. */
  const [pendingText, setPendingText] = useState<string | null>(null);
  /** 员工圆桌群聊选择弹窗（方案 A：合成人格，单会话分饰多角）。 */
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupLaunching, setGroupLaunching] = useState(false);
  /** 群聊态的名称（chat 分支的 agent_name）；null = 当前是单人会话。 */
  const [groupName, setGroupName] = useState<string | null>(null);
  const { launchGroup } = useCompanionGroupLauncher();

  /**
   * 群聊落地：合成人格 → 建会话 → **就地**切到该会话渲染。
   * 不跳 /conversation —— 群聊会话与单人会话共用本工作台的 chat 分支。
   */
  const handleGroupConfirm = useCallback(
    (members: ICompanionProfile[], name: string) => {
      setGroupLaunching(true);
      void launchGroup(members, name)
        .then((groupConversation) => {
          if (!groupConversation) return;
          setGroupOpen(false);
          if (groupConversation.type === 'geekclaw') {
            setGroupName(name.trim() || t('geekclaw.group.modalTitle', { defaultValue: '发起员工群聊' }));
            setSessionId(groupConversation.id);
            setConversation(groupConversation);
            setPhase('chat');
          }
        })
        .finally(() => setGroupLaunching(false));
    },
    [launchGroup, t]
  );

  // ── Session bootstrap ────────────────────────────────────────────────────
  // Read-only probe first: `getCompanionSession` never creates a row, so opening
  // the desk on a never-chatted employee leaves the designed hero in place.
  // 但「没有行」不是唯一的 hero 情形 —— 后端会在建员工时（模型已配好）或任何
  // ensure 入口铸出空会话行，这种空壳也留在 hero（见 sessionHasTurns）。
  useEffect(() => {
    if (!companionId) {
      setBooting(false);
      return;
    }
    let cancelled = false;
    setBooting(true);
    setSessionId(null);
    setConversation(null);
    setGroupName(null);
    setPhase('hero');
    void (async () => {
      try {
        const res = await ipcBridge.companion.getCompanionSession.invoke({ companion_id: companionId });
        const id = res?.conversation_id ?? null;
        if (cancelled || !id) return;
        const conv = await getConversationOrNull(id);
        if (cancelled) return;
        // A dangling session id (row already gone) must not strand the desk in a
        // chat shell with no model — fall back to the hero card instead.
        if (!conv || conv.type !== 'geekclaw') return;
        // 有会话行 ≠ 聊过天：只有真的存着消息才进 chat 分支，否则继续停在会话栏
        // 上（见 sessionHasTurns）。会话 id / 会话对象仍然收下，这样模型、
        // workspace 与首条消息复用同一条专属会话。
        const hasTurns = await sessionHasTurns(id);
        if (cancelled) return;
        setSessionId(id);
        setConversation(conv);
        setPhase(hasTurns ? 'chat' : 'hero');
      } catch {
        // No session (or the row disappeared) — stay on the hero card.
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companionId]);

  const ensureSession = useCallback(async (): Promise<ConversationId> => {
    if (sessionId) return sessionId;
    if (!companionId) throw new Error('missing companion id');
    const thread = await ipcBridge.companion.ensureCompanionSession.invoke({ companion_id: companionId });
    const id = thread.conversation_id;
    const conv = await getConversationOrNull(id);
    setSessionId(id);
    setConversation(conv && conv.type === 'geekclaw' ? conv : null);
    return id;
  }, [companionId, sessionId]);

  // Dispatch a queued first turn *after* NomiChat mounted, so its WebSocket
  // subscription is already bound and no leading stream frame is dropped.
  useEffect(() => {
    if (phase !== 'chat' || !sessionId || pendingText == null) return;
    const text = pendingText;
    setPendingText(null);
    void (async () => {
      try {
        await ipcBridge.conversation.sendMessage.invoke({
          input: text,
          conversation_id: sessionId,
          idempotency_key: uuidv7(),
        });
        emitter.emit('chat.history.refresh');
      } catch (error) {
        Message.error(
          (error as Error)?.message ||
            t('geekclaw.desk.sendFailed', { defaultValue: '发送失败，请重试' })
        );
      }
    })();
  }, [phase, sessionId, pendingText, t]);

  // ── Model selection (locked, mirroring CompanionConversation) ─────────────
  const lockedSelect = useCallback(async () => false, []);
  const modelSelection = useNomiModelSelection({
    initialModel: conversation?.model,
    onSelectModel: lockedSelect,
  });
  const workspace = conversation?.extra?.workspace ?? '';
  const modelConfigured = status ? status.model_configured : profile?.model != null;

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (!modelConfigured) {
      Message.warning(t('conversation.chat.noModelSelected'));
      return;
    }
    setSending(true);
    try {
      await ensureSession();
      setInput('');
      setPendingText(text);
      setPhase('chat');
    } catch (error) {
      Message.error(
        (error as Error)?.message || t('geekclaw.desk.sendFailed', { defaultValue: '发送失败，请重试' })
      );
    } finally {
      setSending(false);
    }
  }, [ensureSession, input, modelConfigured, sending, t]);

  /** 会话栏快捷入口 —— 两个都是页内行为（群聊弹窗 / 设置内的技能页签）。 */
  const entryChips = useMemo(
    () => [
      {
        key: 'summon',
        label: t('geekclaw.desk.summon', { defaultValue: '召唤伙伴' }),
        active: false,
        onClick: () => setGroupOpen(true),
      },
      {
        key: 'skills',
        label: t('geekclaw.desk.skills', { defaultValue: '使用 Skills' }),
        active: false,
        onClick: () => onOpenSettings('skills'),
      },
    ],
    [onOpenSettings, t]
  );

  const name = profile?.name ?? '';
  /** 群聊态显示群名，单人态显示员工名。 */
  const activeName = groupName ?? name;

  /** 标题右侧叠放的小圆头像（名册前 7 位）。 */
  const headAvatars = useMemo(
    () =>
      companions.slice(0, 7).map((item) => (
        <CompanionAvatar
          key={item.companion_id}
          character={item.character}
          companionId={item.companion_id}
          customFigure={customFigureMetaOf(item)}
          mood={(item.status?.mood as CompanionMood) || 'content'}
          activity='idle'
          size={26}
        />
      )),
    [companions]
  );

  /** 「一起工作」成员卡：整份员工名册，点一张就在本页换人。 */
  const rosterMembers = useMemo<TeamHeroMember[]>(
    () =>
      companions.map((item) => ({
        id: item.companion_id,
        name: item.name,
        subtitle: item.status
          ? `Lv${item.status.level} · ${t(`geekclaw.levels.l${Math.min(item.status.level, 5)}`)}`
          : t('geekclaw.companions.createTitle', { defaultValue: '数字员工' }),
        active: item.companion_id === companionId,
        avatar: (
          <CompanionAvatar
            character={item.character}
            companionId={item.companion_id}
            customFigure={customFigureMetaOf(item)}
            mood={(item.status?.mood as CompanionMood) || 'content'}
            activity='idle'
            size={56}
          />
        ),
      })),
    [companionId, companions, t]
  );

  // Identity bar — same grammar as WorkspaceHeader, but the primary action is
  // 设置 and the model switcher rides inside the composer below.
  const identityBar = (
    <div className='shrink-0 flex items-center gap-10px min-w-0 px-24px pt-20px pb-8px'>
      {profile && (
        <CompanionAvatar
          character={profile.character}
          companionId={profile.companion_id}
          customFigure={customFigureMetaOf(profile)}
          mood={(status?.mood as CompanionMood) || 'content'}
          activity='idle'
          size={34}
        />
      )}
      <div className='min-w-0'>
        <div className='text-18px leading-24px font-600 text-t-primary truncate'>{activeName}</div>
        {status && (
          <div className='text-12px leading-18px text-t-tertiary'>
            Lv{status.level} · {t(`geekclaw.levels.l${Math.min(status.level, 5)}`)}
          </div>
        )}
      </div>
      <Button
        size='small'
        shape='round'
        className='shrink-0 ml-6px'
        onClick={() => onOpenSettings('overview')}
      >
        {t('geekclaw.desk.settings', { defaultValue: '设 置' })}
      </Button>
      <div className='flex-1' />
    </div>
  );

  if (booting) {
    return (
      <div className='flex-1 min-h-0 flex flex-col overflow-hidden'>
        {identityBar}
        <div className='flex-1 flex items-center justify-center'>
          <Spin />
        </div>
      </div>
    );
  }

  // ── Chat phase: the companion's real transcript, embedded ─────────────────
  if (phase === 'chat' && sessionId) {
    // NomiChat's send box consumes usePreviewContext(); mount a surface-scoped
    // provider (same grammar as ChatLayout) so the embedded chat works outside
    // the conversation page.
    const previewScope = browserStorageKey('workspace-preview', 'conversation', sessionId);
    return (
      <div className='flex-1 min-h-0 flex flex-col overflow-hidden'>
        {identityBar}
        <PreviewProvider key={previewScope} persistNamespace={previewScope} subscribeGlobalOpen>
          <NomiChat
            conversation_id={sessionId}
            workspace={workspace}
            modelSelection={modelSelection}
            session_mode='yolo'
            hideModeSelector
            agent_name={activeName || undefined}
            emptySlot={
              <div className='flex flex-col items-center gap-12px py-40px px-24px text-center'>
                <p className='m-0 text-20px font-600 leading-tight text-t-primary'>
                  {t('conversation.welcome.title')}
                </p>
                <div className='flex items-center gap-6px h-30px rd-full pl-6px pr-12px bg-[var(--color-bg-2)] border border-[var(--color-border-2)]'>
                  {profile && (
                    <CompanionAvatar
                      character={profile.character}
                      companionId={profile.companion_id}
                      customFigure={customFigureMetaOf(profile)}
                      mood={(status?.mood as CompanionMood) || 'content'}
                      activity='idle'
                      size={22}
                    />
                  )}
                  <span className='text-12px font-600 text-t-primary'>{activeName}</span>
                </div>
              </div>
            }
          />
        </PreviewProvider>
        <CompanionGroupModal
          visible={groupOpen}
          companions={companions}
          loading={companionsLoading}
          confirming={groupLaunching}
          onCancel={() => setGroupOpen(false)}
          onConfirm={handleGroupConfirm}
        />
      </div>
    );
  }

  // ── Hero phase：「与 X 一起工作」会话栏（TeamHero）—— 全部页内行为 ─────────
  return (
    <div className='flex-1 min-h-0 flex flex-col overflow-hidden'>
      {identityBar}

      <TeamHero
        title={name}
        headAvatars={headAvatars}
        members={rosterMembers}
        onSelectMember={(id) => onSelectCompanion(id as CompanionId)}
        chips={entryChips}
        input={input}
        onInputChange={setInput}
        onSend={() => void handleSend()}
        sending={sending}
        placeholder={t('common.teamHero.placeholder', { defaultValue: '输入您的问题…' })}
        modelSlot={<CompanionModelControl companion={companion} showLabel={false} />}
        banner={
          modelConfigured ? undefined : (
            <div className='w-full rd-12px border border-[var(--color-border-2)] bg-[var(--color-bg-2)] px-14px py-10px box-border flex flex-col gap-6px'>
              <span className='text-12px text-t-secondary'>{t('geekclaw.chat.modelMissing')}</span>
              <CompanionModelControl companion={companion} />
            </div>
          )
        }
      />

      <CompanionGroupModal
        visible={groupOpen}
        companions={companions}
        loading={companionsLoading}
        confirming={groupLaunching}
        onCancel={() => setGroupOpen(false)}
        onConfirm={handleGroupConfirm}
      />
    </div>
  );
};

export default CompanionDesk;
