/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * `CapabilitySuggestBar` — suggestion strip that lives above the send box.
 *
 * One horizontal strip of (up to 3) cards. Each card exposes:
 *   - The capability label + confidence %
 *   - A primary action that runs the per-type mount helper
 *     (`runMountAction`) — never mutates global state directly.
 *   - A dismiss (X) that clears the decision from the bar
 *
 * Failure handling:
 *   - Errors from `runMountAction` are surfaced via `Message.error`; the
 *     card stays visible so the user can retry without losing the
 *     suggestion.
 *   - MCP consent is required by product policy. The card renders a
 *     "需要授权" button that opens a confirmation modal before enabling.
 *
 * This component is *pure UI* — it does not own registry/routing state.
 * It is fed `decisions` and a `mount(decision)` callback by the parent
 * (NomiChat), which makes it straightforward to unit-test or reuse
 * elsewhere.
 */

import { Button, Empty, Message, Modal, Tag, Tooltip } from '@arco-design/web-react';
import { Close, Download, Magic, Plus, Robot, Right, Tool } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { enableMcpServer, runMountAction } from './capabilityActions';
import type { CapabilityDecision, CapabilityItem } from './capabilityTypes';

export interface CapabilitySuggestBarProps {
  /** Decisions to show; the bar is hidden when this list is empty. */
  decisions: ReadonlyArray<CapabilityDecision>;
  /** Live registry (used by the per-type actions to resolve payload). */
  registry: CapabilityItem[];
  /** Card-dismissal hook; the parent typically just removes this card. */
  onDismiss?: (decision: CapabilityDecision) => void;
  /** After a successful mount: parent may want to re-build the registry or
   *  close the suggestion, depending on the result.kind. */
  onMounted?: (decision: CapabilityDecision, kind: string) => void;
  /** Where to navigate when an `expert_launched` mount result comes back. */
  onNavigate?: (target: string) => void;
  /** Where to navigate for a `market_jumped` mount result. */
  onJumpMarket?: (target: string) => void;
}

const TYPE_META: Record<CapabilityDecision['type'], { icon: React.ReactNode; labelKey: string; color: string }> = {
  skill: { icon: <Tool theme="outline" size="14" />, labelKey: 'skill', color: 'arcoblue' },
  expert: { icon: <Robot theme="outline" size="14" />, labelKey: 'expert', color: 'purple' },
  mcp: { icon: <Tool theme="outline" size="14" />, labelKey: 'mcp', color: 'orange' },
  plugin: { icon: <Plus theme="outline" size="14" />, labelKey: 'plugin', color: 'green' },
  market_install: { icon: <Download theme="outline" size="14" />, labelKey: 'market_install', color: 'gray' },
};

const ACTION_LABEL: Record<CapabilityDecision['type'], string> = {
  skill: '添加到会话',
  expert: '开启专家会话',
  mcp: '需要授权启用',
  plugin: '启用插件',
  market_install: '前往安装',
};

const CapabilitySuggestBar: React.FC<CapabilitySuggestBarProps> = ({
  decisions,
  registry,
  onDismiss,
  onMounted,
  onNavigate,
  onJumpMarket,
}) => {
  const { t } = useTranslation();
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (!decisions || decisions.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="capability-suggest-bar"
      className='mx-12px mb-8px px-12px py-10px rd-12px bg-fill-1 border border-border-2'
      role='region'
      aria-label={t('conversation.capabilitySuggestBar', { defaultValue: 'AI 推荐能力' })}
    >
      <div className='flex items-center justify-between mb-8px'>
        <div className='flex items-center gap-6px text-12px text-t-secondary'>
          <Robot theme="outline" size="14" />
          <span>{t('conversation.capabilitySuggestHeader', { defaultValue: 'AI 觉得这些能力可能有用' })}</span>
        </div>
      </div>
      <div className='flex flex-col gap-6px'>
        {decisions.map((decision) => (
          <CapabilitySuggestCard
            key={decision.id}
            decision={decision}
            registry={registry}
            isPending={pendingId === decision.id}
            onAction={async (consent) => {
              setPendingId(decision.id);
              try {
                const result = consent
                  ? await enableMcpServer((decision as { id: string }).id?.split(':')[1] ?? decision.id)
                  : await runMountAction(decision, registry);
                if (result.ok) {
                  switch (result.kind) {
                    case 'expert_launched':
                      onNavigate?.(result.navigation_target);
                      break;
                    case 'market_jumped':
                      onJumpMarket?.(result.target);
                      break;
                    case 'mcp_pending':
                      // Open consent modal — the modal's "确认" button should
                      // re-call runMountAction with consent=true.
                      break;
                  }
                  onMounted?.(decision, result.kind);
                } else {
                  const msg = result.kind === 'mount_failed' ? result.error : `操作失败：${result.kind}`;
                  Message.error(msg);
                }
              } finally {
                setPendingId(null);
              }
            }}
            onDismiss={() => onDismiss?.(decision)}
          />
        ))}
      </div>
    </div>
  );
};

interface CardProps {
  decision: CapabilityDecision;
  registry: CapabilityItem[];
  isPending: boolean;
  onAction: (consent?: boolean) => Promise<void>;
  onDismiss: () => void;
}

const CapabilitySuggestCard: React.FC<CardProps> = ({ decision, isPending, onAction, onDismiss }) => {
  const { t } = useTranslation();
  const meta = TYPE_META[decision.type] ?? TYPE_META.skill;

  // MCP requires a confirm step before actually enabling the server.
  const [consentOpen, setConsentOpen] = useState(false);
  const handleClick = () => {
    if (decision.type === 'mcp') {
      Modal.confirm({
        title: t('conversation.capabilityMcpConsentTitle', { defaultValue: '启用 MCP 服务器需要你的授权' }),
        content: t('conversation.capabilityMcpConsentBody', {
          defaultValue: `「${decision.label}」会请求额外权限与本地资源访问，是否启用？`,
        }),
        okText: t('common.confirm', { defaultValue: '确认启用' }),
        cancelText: t('common.cancel', { defaultValue: '取消' }),
        onOk: () => {
          setConsentOpen(false);
          return onAction(true);
        },
      });
      setConsentOpen(true);
      return;
    }
    void onAction();
  };

  const confidencePct = Math.round(decision.confidence * 100);

  return (
    <div className='flex items-center justify-between gap-12px px-12px py-8px rd-8px bg-fill-2 hover:bg-fill-3 transition-colors'>
      <div className='flex items-center gap-10px min-w-0'>
        <Tag color={meta.color} size='small' className='shrink-0'>
          {meta.icon}
          <span className='ml-4px'>{t(`conversation.capabilityType.${decision.type}`, { defaultValue: decision.type })}</span>
        </Tag>
        <div className='min-w-0'>
          <div className='flex items-center gap-6px'>
            <span className='text-13px text-t-primary truncate'>{decision.label}</span>
            <Tooltip content={t('conversation.capabilityConfidenceTooltip', { defaultValue: '置信度 — 仅表示 AI 评估的相关程度' })}>
              <span className='text-11px text-t-tertiary'>{confidencePct}%</span>
            </Tooltip>
          </div>
          {decision.reason && (
            <div className='text-11px text-t-secondary truncate' title={decision.reason}>
              {decision.reason}
            </div>
          )}
        </div>
      </div>
      <div className='flex items-center gap-6px shrink-0'>
        <Button
          type={decision.type === 'market_install' ? 'secondary' : 'primary'}
          size='mini'
          loading={isPending}
          onClick={handleClick}
          icon={decision.type === 'market_install' ? <Right theme="outline" size="12" /> : <Plus theme="outline" size="12" />}
        >
          {t(`conversation.capabilityAction.${decision.type}`, { defaultValue: ACTION_LABEL[decision.type] })}
        </Button>
        <Button
          type='text'
          size='mini'
          icon={<Close theme="outline" size="14" />}
          onClick={onDismiss}
          aria-label={t('common.dismiss', { defaultValue: '忽略' })}
        />
      </div>
      {consentOpen && <span hidden>{/* keep modal mounted reference */}</span>}
    </div>
  );
};

export default CapabilitySuggestBar;
