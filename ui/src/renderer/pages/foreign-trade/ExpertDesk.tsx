/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Message } from '@arco-design/web-react';
import { ArrowUp, BookOne, Brain, Globe, Robot } from '@icon-park/react';
import classNames from 'classnames';
import { ipcBridge } from '@/common';
import { uuidv7 } from '@/common/utils';
import type { TChatConversation } from '@/common/config/storage';
import NomiChat from '@renderer/pages/conversation/platforms/geekclaw/NomiChat';
import { useNomiModelSelection } from '@renderer/pages/conversation/platforms/geekclaw/useNomiModelSelection';
import { resolveExpertIcon } from '@renderer/pages/expert-agents/expertIcons';
import type { ExpertIdentity } from '@renderer/pages/expert-agents/data';
import { emitter } from '@renderer/utils/emitter';

type NomiConversation = Extract<TChatConversation, { type: 'geekclaw' }>;

interface ExpertDeskProps {
  identity: ExpertIdentity;
  /**
   * Cached conversation for this expert (null until the first turn is sent).
   * Owned by the page so switching experts never re-mints a session.
   */
  conversation: TChatConversation | null;
  /** Create the expert's conversation (preset + conversation.create). */
  onEnsureConversation: () => Promise<TChatConversation | null>;
  /** Reveal the conversation in the full conversation page. */
  onOpenConversationPage: () => void;
  /** Open the GeekLink external platform (standalone entry in the roster). */
  onOpenPlatform: () => void;
  /** Open the in-place skill library view. */
  onOpenSkills: () => void;
  /** Pick several experts and start a collaborative conversation. */
  onSummonExpert: () => void;
}

/**
 * 外贸专家工作台 — mirrors CompanionDesk: a real embedded chat surface
 * (NomiChat) rather than a route jump, with the expert's preset-backed session.
 *
 * The session is minted lazily on the first send — experts have no permanent
 * session row like companions do, and `conversation.create` is not idempotent,
 * so minting on select would spam the conversation list for a user who is only
 * browsing the roster.
 */
const ExpertDesk: React.FC<ExpertDeskProps> = ({
  identity,
  conversation,
  onEnsureConversation,
  onOpenConversationPage,
  onOpenPlatform,
  onOpenSkills,
  onSummonExpert,
}) => {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingText, setPendingText] = useState<string | null>(null);

  const nomi = conversation && conversation.type === 'geekclaw' ? (conversation as NomiConversation) : null;
  const Icon = resolveExpertIcon(identity.icon);

  // Dispatch the queued first turn only once the conversation exists and
  // NomiChat has mounted, so no leading stream frame is dropped.
  useEffect(() => {
    if (!nomi || pendingText == null) return;
    const text = pendingText;
    setPendingText(null);
    void (async () => {
      try {
        await ipcBridge.conversation.sendMessage.invoke({
          input: text,
          conversation_id: nomi.id,
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
  }, [nomi, pendingText, t]);

  const lockedSelect = useCallback(async () => false, []);
  const modelSelection = useNomiModelSelection({
    initialModel: nomi?.model,
    onSelectModel: lockedSelect,
  });
  const workspace = nomi?.extra?.workspace ?? '';

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      if (!nomi) {
        const created = await onEnsureConversation();
        if (!created) return;
      }
      setInput('');
      setPendingText(text);
    } catch (error) {
      Message.error(
        (error as Error)?.message ||
          t('geekclaw.desk.sendFailed', { defaultValue: '发送失败，请重试' })
      );
    } finally {
      setSending(false);
    }
  }, [input, nomi, onEnsureConversation, sending, t]);

  const quickPills = [
    { key: 'auto-work', label: t('geekclaw.desk.autoWork', { defaultValue: '自动工作' }), icon: <Robot theme='outline' size='14' fill='currentColor' strokeWidth={3} /> },
    { key: 'idmm', label: t('geekclaw.desk.idmm', { defaultValue: '智能决策' }), icon: <Brain theme='outline' size='14' fill='currentColor' strokeWidth={3} /> },
    { key: 'knowledge', label: t('geekclaw.desk.knowledge', { defaultValue: '知识库' }), icon: <BookOne theme='outline' size='14' fill='currentColor' strokeWidth={3} /> },
  ];

  const entryChips = [
    { key: 'collaborate', label: t('geekclaw.desk.collaborate', { defaultValue: '协作' }), active: true, onClick: onOpenConversationPage },
    { key: 'summon', label: t('foreignTrade.summonExpert', { defaultValue: '召唤专家' }), active: false, onClick: onSummonExpert },
    { key: 'skills', label: t('foreignTrade.expertSkills', { defaultValue: '专家技能' }), active: false, onClick: onOpenSkills },
  ];

  const identityBar = (
    <div className='shrink-0 flex items-center gap-10px min-w-0 px-24px pt-20px pb-8px'>
      <span className='size-34px flex items-center justify-center shrink-0 rd-10px bg-primary-1 text-primary-6'>
        <Icon theme='outline' size='18' fill='currentColor' strokeWidth={3} />
      </span>
      <div className='min-w-0'>
        <div className='text-18px leading-24px font-600 text-t-primary truncate'>{identity.name}</div>
        <div className='text-12px leading-18px text-t-tertiary truncate'>{identity.category}</div>
      </div>
      {nomi && (
        <Button size='small' shape='round' className='shrink-0 ml-6px' onClick={onOpenConversationPage}>
          {t('geekclaw.desk.openInConversation', { defaultValue: '在会话中打开' })}
        </Button>
      )}
      <div className='flex-1' />
      <div className='shrink-0 hidden md:flex items-center gap-8px'>
        {quickPills.map((pill) => (
          <div
            key={pill.key}
            role='button'
            tabIndex={0}
            onClick={onOpenConversationPage}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpenConversationPage();
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

  const heroPill = (
    <div className='flex items-center gap-6px h-34px rd-full pl-8px pr-14px bg-[var(--color-bg-2)] border border-[var(--color-border-2)] shadow-[0_4px_14px_rgba(0,0,0,0.06)]'>
      <span className='size-24px flex items-center justify-center rd-full bg-primary-1 text-primary-6'>
        <Icon theme='outline' size='14' fill='currentColor' strokeWidth={3} />
      </span>
      <span className='text-13px font-600 text-t-primary'>{identity.name}</span>
    </div>
  );

  if (nomi) {
    return (
      <div className='flex-1 min-h-0 flex flex-col overflow-hidden'>
        {identityBar}
        <NomiChat
          conversation_id={nomi.id}
          workspace={workspace}
          modelSelection={modelSelection}
          session_mode='yolo'
          hideModeSelector
          agent_name={identity.name}
          emptySlot={
            <div className='flex flex-col items-center gap-12px py-40px px-24px text-center'>
              <p className='m-0 text-20px font-600 leading-tight text-t-primary'>
                {t('conversation.welcome.title')}
              </p>
              {heroPill}
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className='flex-1 min-h-0 flex flex-col overflow-y-auto'>
      {identityBar}

      <div className='flex-1 flex flex-col items-center justify-center gap-18px px-24px py-32px'>
        <p className='m-0 text-22px font-600 leading-tight text-t-primary text-center'>
          {t('conversation.welcome.title')}
        </p>

        {heroPill}

        <p className='m-0 max-w-520px text-13px leading-20px text-t-tertiary text-center'>
          {identity.description}
        </p>

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
            placeholder={`${identity.name}，${t('conversation.welcome.placeholder')}`}
            className='w-full box-border min-h-64px max-h-160px resize-none bg-transparent border-0 outline-none px-14px pt-10px pb-4px text-13px leading-20px text-t-primary placeholder:text-[var(--color-text-3)]'
            rows={2}
          />
          <div className='flex items-center justify-between px-12px pb-12px'>
            <div
              role='button'
              tabIndex={0}
              aria-label={t('foreignTrade.cardTitle', { defaultValue: 'GeekLink 外贸平台' })}
              onClick={onOpenPlatform}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpenPlatform();
                }
              }}
              className='flex items-center gap-4px h-28px rd-8px px-8px cursor-pointer text-12px text-t-tertiary hover:text-t-primary hover:bg-fill-2 transition-colors outline-none'
            >
              <Globe theme='outline' size='14' fill='currentColor' strokeWidth={3} />
              <span>{t('foreignTrade.enter', { defaultValue: '进入平台' })}</span>
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
      </div>
    </div>
  );
};

export default ExpertDesk;
