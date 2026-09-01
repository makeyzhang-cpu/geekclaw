/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * 协同共答（co-agent）对话页「协作者」面板。
 *
 * 设计铁律（稳定优先、不触碰 shipping 对话流式内部）：
 * - 本面板**不**向消息流/数据库插入任何消息，也不新增消息类型；
 *   协作者的回复以独立的署名「协作者」块呈现在对话主区下方（发送框之上）。
 * - 触发来自 `emitter` 事件总线 `co-agent.turn`（由 NomiSendBox 在用户消息
 *   成功落定后发出），与流式内部完全解耦。
 * - 复用既有 `AgentMessageAvatar` + `MarkdownView` 渲染身份与正文，外观与
 *   Agent 协作消息一致。
 * - 梯度开关（off / manual / keyword / auto）由设置页持久化到
 *   `configKey coAgent.config`；本面板读取该配置决定何时自动参与，manual
 *   模式则暴露「向协作者提问」输入框。
 */

import type { ConversationId } from '@/common/types/ids';
import { ipcBridge } from '@/common';
import {
  DEFAULT_CO_AGENT_CONFIG,
  type ICoAgentConfig,
  type ICoAgentResult,
} from '@/common/types/coAgent';
import { useConfig } from '@/renderer/hooks/config/useConfig';
import { useAddEventListener } from '@/renderer/utils/emitter';
import { useMessageList } from '@/renderer/pages/conversation/Messages/hooks';
import type { IMessageText } from '@/common/chat/chatLib';
import AgentMessageAvatar from '@/renderer/pages/conversation/Messages/components/AgentMessageAvatar';
import MarkdownView from '@renderer/components/Markdown';
import { Button, Input, Spin, Typography } from '@arco-design/web-react';
import { uuid } from '@/common/utils';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

/** 后端纯粹模式门控的镜像：auto / keyword 才参与自动回合；off / manual 不参与。 */
const shouldAutoRun = (config: ICoAgentConfig, message: string): boolean => {
  switch (config.mode) {
    case 'off':
    case 'manual':
      return false;
    case 'keyword':
      return (config.keywords ?? []).some((kw) => kw.length > 0 && message.includes(kw));
    case 'auto':
    default:
      return true;
  }
};

interface CoAgentEntry {
  id: string;
  question: string;
  loading: boolean;
  error?: string;
  result?: ICoAgentResult;
}

/** 从消息列表抽取历史正文文本（排除当前这条「right」用户消息）。 */
const buildHistory = (list: IMessageText[], windowSize: number): string[] => {
  const items = list
    .filter((m): m is IMessageText => m.type === 'text')
    .map((m) => ({ position: m.position, text: m.content?.content }))
    .filter((x): x is { position: 'left' | 'right'; text: string } => typeof x.text === 'string' && x.text.length > 0);

  // 丢弃最后一条「right」消息 = 当前这一轮用户提问（已通过 message 单独下发）。
  let lastRightIdx = -1;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i].position === 'right') {
      lastRightIdx = i;
      break;
    }
  }
  const withoutCurrent = lastRightIdx >= 0 ? items.filter((_, i) => i !== lastRightIdx) : items;
  const texts = withoutCurrent.map((x) => x.text);
  if (windowSize > 0 && texts.length > windowSize) {
    return texts.slice(texts.length - windowSize);
  }
  return texts;
};

const CollaboratorPanel: React.FC<{ conversation_id: ConversationId }> = ({ conversation_id }) => {
  const { t } = useTranslation();
  const [stored] = useConfig('coAgent.config');
  const config: ICoAgentConfig = useMemo(
    () => ({ ...DEFAULT_CO_AGENT_CONFIG, ...(stored ?? {}) }),
    [stored]
  );

  const [entries, setEntries] = useState<CoAgentEntry[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [manualInput, setManualInput] = useState('');

  const list = useMessageList();
  const listRef = useRef(list);
  listRef.current = list;

  const runCoAgent = useCallback(
    async (question: string) => {
      const entryId = uuid();
      setEntries((prev) => [...prev, { id: entryId, question, loading: true }]);
      try {
        const history = buildHistory(listRef.current as IMessageText[], config.history_window || 0);
        const res = await ipcBridge.coAgent.run.invoke({ config, message: question, history });
        if (!res) {
          // 后端门关闭（例如 mode=off）：直接丢弃本次空条目，不渲染。
          setEntries((prev) => prev.filter((e) => e.id !== entryId));
          return;
        }
        setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, loading: false, result: res } : e)));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, loading: false, error: message } : e)));
      } finally {
        // 仅保留最近 8 条，避免无限增长。
        setEntries((prev) => (prev.length > 8 ? prev.slice(prev.length - 8) : prev));
        setExpanded(true);
      }
    },
    [config]
  );

  // 订阅协同共答触发事件（按会话过滤）。
  useAddEventListener(
    'co-agent.turn',
    (payload) => {
      if (payload.conversation_id !== conversation_id) return;
      if (!shouldAutoRun(config, payload.message)) return;
      void runCoAgent(payload.message);
    },
    [conversation_id, config, runCoAgent]
  );

  const submitManual = useCallback(() => {
    const q = manualInput.trim();
    if (!q) return;
    setManualInput('');
    void runCoAgent(q);
  }, [manualInput, runCoAgent]);

  const isManual = config.mode === 'manual';
  const isOff = config.mode === 'off';

  // 关闭模式且无任何历史条目 → 完全不渲染，零视觉干扰。
  if (isOff && entries.length === 0) return null;
  // 自动/关键词模式在尚未产生任何条目时也不渲染（首次回复到达后自动出现）。
  if (!isManual && entries.length === 0) return null;

  return (
    <div className='flex flex-col gap-8px rounded-8px border border-fill-3 bg-fill-1 px-12px py-10px max-h-36vh overflow-y-auto'>
      {isManual && (
        <div className='flex items-center gap-8px'>
          <Input
            size='small'
            value={manualInput}
            placeholder={t('settings.coAgent.askButton')}
            onChange={setManualInput}
            onPressEnter={submitManual}
            className='flex-1'
          />
          <Button size='mini' type='primary' onClick={submitManual}>
            {t('settings.coAgent.askButton')}
          </Button>
        </div>
      )}

      <div className='flex items-center justify-between'>
        <span className='text-12px font-medium text-t-primary'>{config.name}</span>
        <button
          type='button'
          onClick={() => setExpanded((v) => !v)}
          className='text-12px text-t-secondary hover:text-t-primary cursor-pointer bg-transparent border-none'
        >
          {expanded ? '收起' : `展开 (${entries.length})`}
        </button>
      </div>

      {expanded && (
        <div className='flex flex-col gap-12px'>
          {entries.map((entry) => (
            <div key={entry.id} className='flex flex-col gap-2px'>
              {entry.question && (
                <Text className='text-12px text-t-tertiary truncate'>问：{entry.question}</Text>
              )}
              {entry.loading && (
                <div className='flex items-center gap-6px text-t-secondary text-12px'>
                  <Spin size={12} />
                  <span>{t('settings.coAgent.thinking')}</span>
                </div>
              )}
              {entry.error && (
                <Text className='text-12px text-red-500'>{t('settings.coAgent.error', { message: entry.error })}</Text>
              )}
              {entry.result && (
                <div className='flex items-start gap-8px'>
                  <AgentMessageAvatar senderName={entry.result.name} backendLogo={null} />
                  <div className='min-w-0 flex-1'>
                    <div className='text-12px text-t-secondary mb-2px'>{entry.result.name}</div>
                    <div className='text-13px leading-20px text-t-primary break-words'>
                      <MarkdownView>{entry.result.answer}</MarkdownView>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
          {entries.length === 0 && <Text className='text-12px text-t-tertiary'>{t('settings.coAgent.empty')}</Text>}
        </div>
      )}
    </div>
  );
};

export default CollaboratorPanel;
