/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Input, Spin, Tag } from '@arco-design/web-react';
import { Headset, Left, Send } from '@icon-park/react';
import { ipcBridge } from '@/common';
import { parseCsAgentId } from '@/common/types/ids';
import { useCsAgent } from './useCsAgents';

/**
 * Built-in desktop lane ids — mirror of the backend routes.rs DESKTOP_*
 * constants. Fixed canonical UUIDv7-format values (cs_dialogues CHECK
 * constraints reject short strings); the pair is stable across restarts so
 * history always resumes.
 */
const DESKTOP_CHANNEL_PLUGIN_ID = '01978a3e-7c1d-7abc-9def-0123456789ab';
const DESKTOP_CHANNEL_USER_ID = '01978a3e-7c1d-7abc-9def-0123456789ac';

/** 纯 UI 气泡：历史 ICsMessage 与本地乐观消息统一映射到此形状。 */
type ChatBubble = { role: 'visitor' | 'agent'; content: string; ts: number };

const ChatBubbleView: React.FC<{ bubble: ChatBubble }> = ({ bubble }) => {
  const mine = bubble.role === 'visitor';
  return (
    <div className={`flex w-full ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[76%] box-border px-12px py-8px rd-12px text-13px leading-20px whitespace-pre-wrap break-words ${
          mine ? 'text-white rd-br-4px' : 'bg-[var(--color-fill-2)] text-t-primary rd-bl-4px'
        }`}
        style={mine ? { background: 'rgb(var(--primary-6))' } : undefined}
      >
        {bubble.content}
      </div>
    </div>
  );
};

/**
 * 客服对话窗（/customer-service/:cs_agent_id/chat）—— 桌面内置聊天 lane。
 *
 * 每条消息都走 GeekClaw 原生客服对话引擎（agent 配置的 provider/model +
 * 三个只读工具白名单），无任何外部客服服务依赖；历史经 desktop lane 恢复。
 */
const CsChatPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { cs_agent_id: rawId } = useParams<{ cs_agent_id: string }>();
  const agentId = rawId ? parseCsAgentId(rawId) : null;
  const { agent, loading } = useCsAgent(agentId);

  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const modelReady = Boolean(agent?.provider_id && agent?.model);
  const chatBlocked = loading || !agent || !agent.enabled || !modelReady;

  // 恢复桌面 lane 的历史消息（固定 desktop 三元组）。
  useEffect(() => {
    if (!agentId || loading) return;
    let cancelled = false;
    void (async () => {
      try {
        const dialogues = await ipcBridge.customerService.listDialogues.invoke({
          cs_agent_id: agentId,
        });
        const lane = dialogues.find(
          (d) =>
            d.channel_plugin_id === DESKTOP_CHANNEL_PLUGIN_ID
            && d.channel_user_id === DESKTOP_CHANNEL_USER_ID
        );
        if (!lane) {
          if (!cancelled) setBubbles([]);
          return;
        }
        const messages = await ipcBridge.customerService.listDialogueMessages.invoke({
          cs_dialogue_id: lane.cs_dialogue_id,
        });
        if (cancelled) return;
        setBubbles(
          messages
            .filter((m) => m.role === 'visitor' || m.role === 'agent')
            .map((m) => ({ role: m.role as 'visitor' | 'agent', content: m.content, ts: m.created_at }))
        );
      } catch {
        if (!cancelled) setBubbles([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, loading]);

  // 新消息 / typing 时滚到底部。
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [bubbles, sending]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !agentId || chatBlocked || sending) return;
    setInput('');
    setError(null);
    setBubbles((prev) => [...prev, { role: 'visitor', content: text, ts: Date.now() }]);
    setSending(true);
    try {
      const { reply } = await ipcBridge.customerService.chat.invoke({
        cs_agent_id: agentId,
        text,
      });
      if (reply) {
        setBubbles((prev) => [...prev, { role: 'agent', content: reply, ts: Date.now() }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [input, agentId, chatBlocked, sending]);

  if (loading) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <Spin />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className='flex h-full w-full flex-col items-center justify-center gap-12px px-24px text-center'>
        <span className='text-14px text-t-secondary'>
          {t('customerService.detail.notFound', { defaultValue: '客服不存在或已删除' })}
        </span>
        <Button onClick={() => void navigate('/customer-service')}>
          {t('customerService.detail.back', { defaultValue: '返回花名册' })}
        </Button>
      </div>
    );
  }

  return (
    <div className='flex h-full w-full flex-col box-border'>
      {/* Header */}
      <div className='flex shrink-0 items-center gap-12px border-b border-solid border-[var(--color-border-2)] px-16px py-10px'>
        <Button
          size='small'
          type='text'
          onClick={() => void navigate(`/customer-service/${agent.cs_agent_id}`)}
        >
          <span className='inline-flex items-center gap-4px'>
            <Left theme='outline' size='14' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
            {t('customerService.chat.back', { defaultValue: '返回详情' })}
          </span>
        </Button>
        <span
          className='flex items-center justify-center w-30px h-30px rd-8px shrink-0 text-primary-6'
          style={{
            background: 'linear-gradient(150deg, rgba(var(--primary-5),0.16) 0%, rgba(var(--primary-6),0.26) 100%)',
            border: '1px solid rgba(var(--primary-6),0.22)',
          }}
        >
          <Headset theme='outline' size='17' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
        </span>
        <span className='text-14px font-600 text-t-primary truncate'>{agent.name}</span>
        <Tag className='shrink-0' color={agent.enabled ? 'green' : 'gray'} size='small'>
          {agent.enabled
            ? t('customerService.status.enabled', { defaultValue: '服务中' })
            : t('customerService.status.disabled', { defaultValue: '已停用' })}
        </Tag>
        {modelReady && (
          <Tag className='shrink-0' size='small'>
            {agent.model}
          </Tag>
        )}
      </div>

      {/* Messages */}
      <div ref={listRef} className='min-h-0 flex-1 overflow-y-auto px-20px py-16px'>
        <div className='mx-auto flex w-full max-w-[820px] flex-col gap-12px'>
          {bubbles.length === 0 && agent.greeting.trim() !== '' && (
            <ChatBubbleView bubble={{ role: 'agent', content: agent.greeting, ts: 0 }} />
          )}
          {bubbles.map((bubble, index) => (
            <ChatBubbleView key={`${bubble.ts}-${index}`} bubble={bubble} />
          ))}
          {sending && (
            <div className='flex w-full justify-start'>
              <div className='bg-[var(--color-fill-2)] rd-12px rd-bl-4px px-12px py-8px text-13px text-t-tertiary'>
                {t('customerService.chat.typing', { defaultValue: '正在输入…' })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className='shrink-0 border-t border-solid border-[rgb(var(--red-3))] bg-[rgba(var(--red-1),0.6)] px-20px py-8px text-12px text-[rgb(var(--red-6))]'>
          {t('customerService.chat.error', { defaultValue: '回复失败，请稍后重试。' })}（{error}）
        </div>
      )}

      {/* Composer */}
      <div className='shrink-0 border-t border-solid border-[var(--color-border-2)] px-20px py-14px'>
        <div className='mx-auto flex w-full max-w-[820px] flex-col gap-8px'>
          <div className='flex items-end gap-10px'>
            <Input.TextArea
              value={input}
              onChange={setInput}
              disabled={chatBlocked}
              autoSize={{ minRows: 1, maxRows: 6 }}
              placeholder={t('customerService.chat.placeholder', {
                defaultValue: '输入消息，Enter 发送，Shift+Enter 换行',
              })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <Button
              type='primary'
              loading={sending}
              disabled={chatBlocked || input.trim() === ''}
              onClick={() => void send()}
              className='shrink-0'
            >
              <span className='inline-flex items-center gap-6px'>
                <Send theme='outline' size='14' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
                {t('customerService.chat.send', { defaultValue: '发送' })}
              </span>
            </Button>
          </div>
          {!modelReady && (
            <span className='text-12px text-t-tertiary'>
              {t('customerService.chat.needModel', {
                defaultValue: '该客服未配置对话模型 — 请先到详情页的「模型与知识库」中选择。',
              })}
            </span>
          )}
          {modelReady && !agent.enabled && (
            <span className='text-12px text-t-tertiary'>
              {t('customerService.chat.agentDisabled', {
                defaultValue: '该客服已停用，启用后才能接待访客。',
              })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default CsChatPage;
