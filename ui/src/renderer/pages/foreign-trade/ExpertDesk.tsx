/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Message } from '@arco-design/web-react';
import { Globe } from '@icon-park/react';
import { ipcBridge } from '@/common';
import { uuidv7 } from '@/common/utils';
import type { TChatConversation } from '@/common/config/storage';
import NomiChat from '@renderer/pages/conversation/platforms/geekclaw/NomiChat';
import { useNomiModelSelection } from '@renderer/pages/conversation/platforms/geekclaw/useNomiModelSelection';
import { PreviewProvider } from '@renderer/pages/conversation/Preview';
import PersonAvatar from '@renderer/pages/expert-agents/PersonAvatar';
import type { ExpertIdentity } from '@renderer/pages/expert-agents/data';
import TeamHero from '@renderer/components/collaboration/TeamHero';
import type { TeamHeroMember } from '@renderer/components/collaboration/TeamHero';
import { emitter } from '@renderer/utils/emitter';
import { browserStorageKey } from '@/common/utils/browserStorageKey';

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
  /** Open the external platform (standalone entry in the roster). */
  onOpenPlatform: () => void;
  /** Label of the external-platform entry (defaults to GeekLink 专业外贸系统). */
  platformLabel?: string;
  /** Label of the「进入……」link under the composer. Defaults to
   *  「进入GeekLink外贸系统」; the B2B外贸运营工作台 passes its own. */
  platformEnterLabel?: string;
  /** Open the in-place skill library view. */
  onOpenSkills: () => void;
  /** Pick several experts and start a collaborative conversation (in place). */
  onSummonExpert: () => void;
  /**
   * 名册级已分配的人物形象（与左栏同一张脸）；缺省按 seed 现算。
   */
  figureSrc?: string;
  /** 「一起工作」成员卡：该工作台的专家名册（含当前专家）。 */
  members: TeamHeroMember[];
  /** 点成员卡 —— 调用方在**本页内**切到该专家（不得跳转会话页）。 */
  onSelectMember: (id: string) => void;
  /** 成员卡区的小标题（如「本工作台专家」）。 */
  membersTitle?: string;
}

/**
 * 专家工作台 — mirrors CompanionDesk: a real embedded chat surface
 * (NomiChat) rather than a route jump, with the expert's preset-backed session.
 *
 * The session is minted lazily on the first send — experts have no permanent
 * session row like companions do, and `conversation.create` is not idempotent,
 * so minting on select would spam the conversation list for a user who is only
 * browsing the roster.
 *
 * 会话栏（TeamHero）：标题 + 头像组 + 大输入框 + 横排专家卡片，全部**页内**行为 ——
 * 点卡片换专家、召唤专家组队、开技能库、发消息，任何情况下都不跳 /conversation。
 */
const ExpertDesk: React.FC<ExpertDeskProps> = ({
  identity,
  conversation,
  onEnsureConversation,
  onOpenPlatform,
  platformLabel,
  platformEnterLabel,
  onOpenSkills,
  onSummonExpert,
  figureSrc,
  members,
  onSelectMember,
  membersTitle,
}) => {
  const { t } = useTranslation();
  const resolvedPlatformLabel =
    platformLabel ?? t('foreignTrade.cardTitle', { defaultValue: 'GeekLink 专业外贸系统' });
  const resolvedPlatformEnterLabel =
    platformEnterLabel ?? t('foreignTrade.enter', { defaultValue: '进入GeekLink外贸系统' });
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingText, setPendingText] = useState<string | null>(null);

  const nomi = conversation && conversation.type === 'geekclaw' ? (conversation as NomiConversation) : null;

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

  /** 会话栏快捷入口 —— 两个都是页内行为（多专家弹窗 / 页内技能库）。 */
  const entryChips = useMemo(
    () => [
      {
        key: 'summon',
        label: t('foreignTrade.summonExpert', { defaultValue: '召唤专家' }),
        active: false,
        onClick: onSummonExpert,
      },
      {
        key: 'skills',
        label: t('foreignTrade.expertSkills', { defaultValue: '专家技能' }),
        active: false,
        onClick: onOpenSkills,
      },
    ],
    [onOpenSkills, onSummonExpert, t]
  );

  /** 标题右侧叠放的小圆头像（名册前 7 位）。 */
  const headAvatars = useMemo(
    () =>
      members.slice(0, 7).map((member) => (
        <PersonAvatar key={member.id} seed={member.id} size={26} src={member.figureSrc} title={member.name} />
      )),
    [members]
  );

  const identityBar = (
    <div className='shrink-0 flex items-center gap-10px min-w-0 px-24px pt-20px pb-8px'>
      <PersonAvatar seed={identity.id || identity.name} size={34} shape='square' src={figureSrc} title={identity.name} />
      <div className='min-w-0'>
        <div className='text-18px leading-24px font-600 text-t-primary truncate'>{identity.name}</div>
        <div className='text-12px leading-18px text-t-tertiary truncate'>{identity.category}</div>
      </div>
      <div className='flex-1' />
    </div>
  );

  if (nomi) {
    // NomiChat's send box consumes usePreviewContext(); mount a surface-scoped
    // provider (same grammar as ChatLayout) so the embedded chat works outside
    // the conversation page.
    const previewScope = browserStorageKey('workspace-preview', 'conversation', nomi.id);
    return (
      <div className='flex-1 min-h-0 flex flex-col overflow-hidden'>
        {identityBar}
        <PreviewProvider key={previewScope} persistNamespace={previewScope} subscribeGlobalOpen>
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
                <div className='flex items-center gap-6px h-30px rd-full pl-8px pr-14px bg-[var(--color-bg-2)] border border-[var(--color-border-2)]'>
                  <PersonAvatar seed={identity.id || identity.name} size={22} src={figureSrc} title={identity.name} />
                  <span className='text-12px font-600 text-t-primary'>{identity.name}</span>
                </div>
              </div>
            }
          />
        </PreviewProvider>
      </div>
    );
  }

  return (
    <div className='flex-1 min-h-0 flex flex-col overflow-hidden'>
      {identityBar}

      <TeamHero
        title={identity.name}
        headAvatars={headAvatars}
        members={members}
        onSelectMember={onSelectMember}
        membersTitle={membersTitle}
        chips={entryChips}
        input={input}
        onInputChange={setInput}
        onSend={() => void handleSend()}
        sending={sending}
        placeholder={t('common.teamHero.placeholder', { defaultValue: '输入您的问题…' })}
        footer={
          <div className='flex flex-col gap-6px'>
            <p className='m-0 text-13px leading-20px text-t-tertiary'>{identity.description}</p>
            <div
              role='button'
              tabIndex={0}
              aria-label={resolvedPlatformLabel}
              onClick={onOpenPlatform}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpenPlatform();
                }
              }}
              className='flex items-center gap-5px h-28px rd-8px px-8px -ml-8px w-fit cursor-pointer text-12px text-t-tertiary hover:text-t-primary hover:bg-fill-2 transition-colors outline-none'
            >
              <Globe theme='outline' size='14' fill='currentColor' strokeWidth={3} />
              <span>{resolvedPlatformEnterLabel}</span>
            </div>
          </div>
        }
      />
    </div>
  );
};

export default ExpertDesk;
