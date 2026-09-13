/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Message, Spin } from '@arco-design/web-react';
import { ArrowUp, BookOne, Brain, FolderOpen, Plus, Robot } from '@icon-park/react';
import classNames from 'classnames';
import { ipcBridge } from '@/common';
import { uuidv7 } from '@/common/utils';
import type { TChatConversation } from '@/common/config/storage';
import type { ConversationId } from '@/common/types/ids';
import CompanionAvatar from '@renderer/pages/companion/CompanionAvatar';
import { customFigureMetaOf } from '@renderer/pages/companion/characters/customMeta';
import type { CompanionMood } from '@renderer/pages/companion/characters';
import NomiChat from '@renderer/pages/conversation/platforms/geekclaw/NomiChat';
import { useNomiModelSelection } from '@renderer/pages/conversation/platforms/geekclaw/useNomiModelSelection';
import { getConversationOrNull } from '@renderer/pages/conversation/utils/conversationCache';
import { emitter } from '@renderer/utils/emitter';
import type { CompanionHandle, WorkspaceTabKey } from './workspace/types';

type NomiConversation = Extract<TChatConversation, { type: 'geekclaw' }>;

interface CompanionDeskProps {
  companion: CompanionHandle;
  /** Open the settings workspace on the given tab. */
  onOpenSettings: (tab: WorkspaceTabKey) => void;
  /** Reveal this companion's session in the full conversation page. */
  onOpenChat: () => void;
}

interface DeskQuickPill {
  key: string;
  label: string;
  icon: React.ReactNode;
}

/**
 * 员工工作台 — the landing surface when a companion is picked from the roster.
 *
 * This is a *real* chat surface, not a launchpad: the companion's canonical
 * session is embedded through `NomiChat`, so the desk renders the full
 * transcript (tool cards / thinking / artifacts / Markdown) and accepts turns
 * in place — no route jump into /conversation/:id.
 *
 * Two phases:
 *  - **hero** — no session yet (or the session row vanished). Renders the
 *    designed hero card; the first send mints the session via
 *    `ensureCompanionSession`, flips to `chat`, and only *then* dispatches the
 *    message, so `NomiChat`'s stream subscription is live before the first
 *    assistant frame can arrive.
 *  - **chat** — embedded `NomiChat`, pinned to the companion's constraints
 *    (locked model, forced yolo, fixed workspace) exactly like
 *    `CompanionConversation` does inside the conversation page.
 *
 * Session-level controls (自动工作 / 智能决策 / 知识库) stay on the full
 * conversation page via `onOpenChat`; re-hosting those three panels here would
 * duplicate a second, divergence-prone copy of their state machines.
 */
const CompanionDesk: React.FC<CompanionDeskProps> = ({ companion, onOpenSettings, onOpenChat }) => {
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

  // ── Session bootstrap ────────────────────────────────────────────────────
  // Read-only probe first: `getCompanionSession` never creates a row, so opening
  // the desk on a never-chatted employee leaves the designed hero in place.
  useEffect(() => {
    if (!companionId) {
      setBooting(false);
      return;
    }
    let cancelled = false;
    setBooting(true);
    setSessionId(null);
    setConversation(null);
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
        setSessionId(id);
        setConversation(conv);
        setPhase('chat');
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

  const quickPills: DeskQuickPill[] = [
    { key: 'auto-work', label: t('geekclaw.desk.autoWork', { defaultValue: '自动工作' }), icon: <Robot theme='outline' size='14' fill='currentColor' strokeWidth={3} /> },
    { key: 'idmm', label: t('geekclaw.desk.idmm', { defaultValue: '智能决策' }), icon: <Brain theme='outline' size='14' fill='currentColor' strokeWidth={3} /> },
    { key: 'knowledge', label: t('geekclaw.desk.knowledge', { defaultValue: '知识库' }), icon: <BookOne theme='outline' size='14' fill='currentColor' strokeWidth={3} /> },
  ];

  const entryChips = [
    { key: 'collaborate', label: t('geekclaw.desk.collaborate', { defaultValue: '协作' }), active: true, onClick: onOpenChat },
    {
      key: 'summon',
      label: t('geekclaw.desk.summon', { defaultValue: '召唤伙伴' }),
      active: false,
      onClick: onOpenChat,
    },
    {
      key: 'skills',
      label: t('geekclaw.desk.skills', { defaultValue: '使用 Skills' }),
      active: false,
      onClick: () => onOpenSettings('skills'),
    },
  ];

  const name = profile?.name ?? '';

  // Identity bar — same grammar as WorkspaceHeader, but the primary action is
  // 设置 and the session-level quick pills ride on the right.
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
        <div className='text-18px leading-24px font-600 text-t-primary truncate'>{name}</div>
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
      <div className='shrink-0 hidden md:flex items-center gap-8px'>
        {quickPills.map((pill) => (
          <div
            key={pill.key}
            role='button'
            tabIndex={0}
            onClick={onOpenChat}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpenChat();
              }
            }}
            className='flex items-center gap-5px h-30px rd-full px-12px cursor-pointer text-12px text-t-secondary bg-fill-2 hover:bg-fill-3 hover:text-t-primary transition-colors outline-none'
          >
            {pill.icon}
            <span className='truncate'>{pill.label}</span>
          </div>
        ))}
      </div>
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
    return (
      <div className='flex-1 min-h-0 flex flex-col overflow-hidden'>
        {identityBar}
        <NomiChat
          conversation_id={sessionId}
          workspace={workspace}
          modelSelection={modelSelection}
          session_mode='yolo'
          hideModeSelector
          agent_name={name || undefined}
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
                <span className='text-12px font-600 text-t-primary'>{name}</span>
              </div>
            </div>
          }
        />
      </div>
    );
  }

  // ── Hero phase: designed launchpad card, first send starts the session ─────
  return (
    <div className='flex-1 min-h-0 flex flex-col overflow-y-auto'>
      {identityBar}

      <div className='flex-1 flex flex-col items-center justify-center gap-18px px-24px py-32px'>
        <p className='m-0 text-22px font-600 leading-tight text-t-primary text-center'>
          {t('conversation.welcome.title')}
        </p>

        <div className='flex items-center gap-10px'>
          <div className='flex items-center gap-6px h-34px rd-full pl-6px pr-14px bg-[var(--color-bg-2)] border border-[var(--color-border-2)] shadow-[0_4px_14px_rgba(0,0,0,0.06)]'>
            {profile && (
              <CompanionAvatar
                character={profile.character}
                companionId={profile.companion_id}
                customFigure={customFigureMetaOf(profile)}
                mood={(status?.mood as CompanionMood) || 'content'}
                activity='idle'
                size={26}
              />
            )}
            <span className='text-13px font-600 text-t-primary'>{name}</span>
          </div>
          <span className='w-1px h-18px bg-[var(--color-border-2)]' />
          <div
            role='button'
            tabIndex={0}
            aria-label={t('geekclaw.companions.create')}
            onClick={() => void handleSend()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                void handleSend();
              }
            }}
            className='flex items-center justify-center size-30px rd-full cursor-pointer text-t-secondary hover:text-t-primary hover:bg-fill-2 transition-colors outline-none'
          >
            <Plus theme='outline' size='16' fill='currentColor' strokeWidth={3} />
          </div>
        </div>

        <div className='w-full max-w-720px rd-16px bg-[var(--color-bg-2)] border border-[var(--color-border-2)] shadow-[0_10px_30px_rgba(0,0,0,0.07)] box-border'>
          <div className='flex items-center gap-8px px-14px pt-12px'>
            {entryChips.map((chip) => (
              <div
                key={chip.key}
                role='button'
                tabIndex={0}
                onClick={chip.onClick}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    chip.onClick();
                  }
                }}
                className={classNames(
                  'flex items-center gap-4px h-26px rd-full px-10px cursor-pointer text-12px transition-colors outline-none',
                  chip.active
                    ? 'font-600 text-primary-6 bg-[rgba(var(--primary-6),0.10)]'
                    : 'text-t-secondary hover:bg-fill-2 hover:text-t-primary'
                )}
              >
                {chip.label}
              </div>
            ))}
          </div>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void handleSend();
              }
            }}
            placeholder={`${name}，${t('conversation.welcome.placeholder')}`}
            className='w-full box-border min-h-64px max-h-160px resize-none bg-transparent border-0 outline-none px-14px pt-10px pb-4px text-13px leading-20px text-t-primary placeholder:text-[var(--color-text-3)]'
            rows={2}
          />
          <div className='flex items-center justify-between px-12px pb-12px'>
            <div
              role='button'
              tabIndex={0}
              aria-label={t('conversation.welcome.linkFolder')}
              onClick={onOpenChat}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpenChat();
                }
              }}
              className='flex items-center justify-center size-28px rd-8px cursor-pointer text-t-tertiary hover:text-t-primary hover:bg-fill-2 transition-colors outline-none'
            >
              <Plus theme='outline' size='15' fill='currentColor' strokeWidth={3} />
            </div>
            <div
              role='button'
              tabIndex={0}
              aria-label={t('geekclaw.openChat')}
              onClick={() => void handleSend()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              className={classNames(
                'flex items-center justify-center size-30px rd-full cursor-pointer text-[var(--color-bg-1)] bg-primary-6 hover:bg-primary-5 transition-colors outline-none',
                (sending || !input.trim()) && 'opacity-50 cursor-not-allowed'
              )}
            >
              <ArrowUp theme='outline' size='15' fill='currentColor' strokeWidth={4} />
            </div>
          </div>
        </div>

        <div
          role='button'
          tabIndex={0}
          onClick={onOpenChat}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onOpenChat();
            }
          }}
          className='flex items-center gap-6px h-30px rd-8px px-10px cursor-pointer text-12px text-t-tertiary hover:text-t-secondary hover:bg-fill-2 transition-colors outline-none'
        >
          <FolderOpen theme='outline' size='14' fill='currentColor' strokeWidth={3} />
          <span>{t('geekclaw.desk.workInProject', { defaultValue: '在项目中工作' })}</span>
        </div>
      </div>
    </div>
  );
};

export default CompanionDesk;
