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
 * - 协作记录按会话持久化到 localStorage（`coagent.records:<conversation_id>`，
 *   上限 200 条），面板头部「协作记录」可查询/清空——面板内存条目仍只留
 *   最近 8 条，历史不随面板卸载丢失。
 * - 协作者模型可在面板头部直接选择（写入同一 `coAgent.config`）；未显式
 *   选择时保持旧行为「跟随会话主模型」。
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
import NomiSelect from '@/renderer/components/base/NomiSelect';
import { useModelsForTask } from '@/renderer/hooks/agent/useModelsForTask';
import { useModelSelectorProviderLabel } from '@/renderer/hooks/agent/useModelSelectorProviderLabel';
import { Button, Empty, Input, Message, Modal, Spin, Typography } from '@arco-design/web-react';
import { uuid } from '@/common/utils';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NomiModelSelection } from '@/renderer/pages/conversation/platforms/geekclaw/useNomiModelSelection';

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

/** 持久化的单条协作记录（问 + 署名回复），按会话存 localStorage。 */
interface CoAgentRecord {
  id: string;
  question: string;
  name: string;
  answer: string;
  error?: string;
  created_at: number;
}

const RECORDS_CAP = 200;
const recordsKeyOf = (conversationId: ConversationId): string => `coagent.records:${conversationId}`;

const loadCoAgentRecords = (conversationId: ConversationId): CoAgentRecord[] => {
  try {
    const raw = window.localStorage.getItem(recordsKeyOf(conversationId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as CoAgentRecord[]) : [];
  } catch {
    return [];
  }
};

const appendCoAgentRecord = (conversationId: ConversationId, record: CoAgentRecord): void => {
  try {
    const next = [...loadCoAgentRecords(conversationId), record].slice(-RECORDS_CAP);
    window.localStorage.setItem(recordsKeyOf(conversationId), JSON.stringify(next));
  } catch {
    // Quota / privacy mode — records are best-effort, never break the turn.
  }
};

const clearCoAgentRecords = (conversationId: ConversationId): void => {
  try {
    window.localStorage.removeItem(recordsKeyOf(conversationId));
  } catch {
    // noop
  }
};

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

const CollaboratorPanel: React.FC<{
  conversation_id: ConversationId;
  /** 会话主模型选择器：协作者未显式配置 provider/model 时跟随它，保证与会话一致。 */
  modelSelection: NomiModelSelection;
}> = ({ conversation_id, modelSelection }) => {
  const { t } = useTranslation();
  const [stored, setStored] = useConfig('coAgent.config');
  const config: ICoAgentConfig = useMemo(
    () => ({ ...DEFAULT_CO_AGENT_CONFIG, ...(stored ?? {}) }),
    [stored]
  );

  const [entries, setEntries] = useState<CoAgentEntry[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [manualInput, setManualInput] = useState('');

  // ── 协作记录（localStorage 持久化 + 查询弹窗） ────────────────────────────
  const [records, setRecords] = useState<CoAgentRecord[]>([]);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [recordQuery, setRecordQuery] = useState('');
  useEffect(() => {
    setRecords(loadCoAgentRecords(conversation_id));
    setRecordQuery('');
  }, [conversation_id]);

  const list = useMessageList();
  const listRef = useRef(list);
  listRef.current = list;

  const runCoAgent = useCallback(
    async (question: string) => {
      const entryId = uuid();
      setEntries((prev) => [...prev, { id: entryId, question, loading: true }]);
      try {
      const history = buildHistory(listRef.current as IMessageText[], config.history_window || 0);
      // 模型跟随会话：设置页未显式指定协作者 provider/model 时，注入当前会话主模型
      // （provider_id=modelSelection.current_model.id / model=use_model）。避免回落后端
      // 全局 resolve_default_model → 本地会话 + 云端默认模型渠道缺失 → 502 Bad gateway。
      const cur = modelSelection.current_model;
      const requestConfig: ICoAgentConfig =
        cur?.id && cur.use_model && (!config.provider_id || !config.model)
          ? { ...config, provider_id: cur.id, model: cur.use_model }
          : config;
      const res = await ipcBridge.coAgent.run.invoke({
        config: requestConfig,
        message: question,
        history,
      });
        if (!res) {
          // 后端门关闭（例如 mode=off）：直接丢弃本次空条目，不渲染。
          setEntries((prev) => prev.filter((e) => e.id !== entryId));
          return;
        }
        setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, loading: false, result: res } : e)));
        const record: CoAgentRecord = {
          id: entryId,
          question,
          name: res.name,
          answer: res.answer,
          created_at: Date.now(),
        };
        appendCoAgentRecord(conversation_id, record);
        setRecords((prev) => [...prev, record].slice(-RECORDS_CAP));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, loading: false, error: message } : e)));
        const record: CoAgentRecord = {
          id: entryId,
          question,
          name: config.name,
          answer: '',
          error: message,
          created_at: Date.now(),
        };
        appendCoAgentRecord(conversation_id, record);
        setRecords((prev) => [...prev, record].slice(-RECORDS_CAP));
      } finally {
        // 仅保留最近 8 条，避免无限增长。
        setEntries((prev) => (prev.length > 8 ? prev.slice(prev.length - 8) : prev));
        setExpanded(true);
      }
    },
    [config, conversation_id, modelSelection.current_model?.id, modelSelection.current_model?.use_model]
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

  // ── 协作者模型就地选择（写入 coAgent.config，全局面板/设置页同源） ─────────
  const { groups: chatGroups } = useModelsForTask('chat');
  const providerLabel = useModelSelectorProviderLabel();
  const modelOptions = useMemo(
    () =>
      chatGroups.flatMap((group) =>
        group.models.map((model) => ({
          key: `${group.provider.id}::${model}`,
          value: `${group.provider.id}::${model}`,
          label: `${providerLabel(group.provider)} · ${model}`,
        }))
      ),
    [chatGroups, providerLabel]
  );
  const explicitModelValue =
    config.provider_id && config.model ? `${config.provider_id}::${config.model}` : '';
  const onModelPick = useCallback(
    (value: string) => {
      if (!value) {
        // 跟随会话模型（旧行为）：清空显式指定。
        void setStored({ ...config, provider_id: '', model: '' });
        return;
      }
      const splitAt = value.indexOf('::');
      if (splitAt <= 0) return;
      void setStored({
        ...config,
        provider_id: value.slice(0, splitAt),
        model: value.slice(splitAt + 2),
      });
    },
    [config, setStored]
  );

  // ── 记录查询 ──────────────────────────────────────────────────────────────
  const filteredRecords = useMemo(() => {
    const query = recordQuery.trim().toLowerCase();
    const ordered = [...records].reverse();
    if (!query) return ordered;
    return ordered.filter((record) =>
      [record.question, record.answer, record.name, record.error ?? '']
        .join('\n')
        .toLowerCase()
        .includes(query)
    );
  }, [records, recordQuery]);

  const handleClearRecords = useCallback(() => {
    clearCoAgentRecords(conversation_id);
    setRecords([]);
    Message.success(t('conversation.collab.recordsCleared', { defaultValue: '协作记录已清空' }));
  }, [conversation_id, t]);

  const isManual = config.mode === 'manual';
  const isOff = config.mode === 'off';

  // 关闭模式且无任何历史条目 → 完全不渲染，零视觉干扰。
  if (isOff && entries.length === 0 && records.length === 0) return null;
  // 自动/关键词模式在尚未产生任何条目时也不渲染（首次回复到达后自动出现）。
  if (!isManual && entries.length === 0 && records.length === 0) return null;

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

      <div className='flex items-center gap-8px min-w-0'>
        <span className='text-12px font-medium text-t-primary shrink-0'>{config.name}</span>
        <NomiSelect
          size='mini'
          contentFit
          contentMaxWidth={320}
          className='min-w-0 max-w-240px'
          placeholder={t('conversation.collab.followSession', { defaultValue: '跟随会话模型' })}
          value={explicitModelValue || undefined}
          onChange={(value: string) => onModelPick(value ?? '')}
        >
          <NomiSelect.Option key='follow-session' value=''>
            {t('conversation.collab.followSession', { defaultValue: '跟随会话模型' })}
          </NomiSelect.Option>
          {modelOptions.map((option) => (
            <NomiSelect.Option key={option.key} value={option.value}>
              {option.label}
            </NomiSelect.Option>
          ))}
        </NomiSelect>
        <div className='flex-1' />
        <button
          type='button'
          onClick={() => setRecordsOpen(true)}
          className='text-12px text-t-secondary hover:text-t-primary cursor-pointer bg-transparent border-none shrink-0'
          data-testid='collab-records-button'
        >
          {t('conversation.collab.records', { defaultValue: '协作记录' })}
          {records.length > 0 && <span className='op-60'>{` (${records.length})`}</span>}
        </button>
        <button
          type='button'
          onClick={() => setExpanded((v) => !v)}
          className='text-12px text-t-secondary hover:text-t-primary cursor-pointer bg-transparent border-none shrink-0'
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

      <Modal
        title={t('conversation.collab.records', { defaultValue: '协作记录' })}
        visible={recordsOpen}
        onCancel={() => setRecordsOpen(false)}
        footer={null}
        style={{ width: 560, maxWidth: 'calc(100vw - 32px)' }}
      >
        <div className='flex flex-col gap-10px'>
          <div className='flex items-center gap-8px'>
            <Input.Search
              allowClear
              size='small'
              placeholder={t('conversation.collab.searchRecords', { defaultValue: '搜索问题 / 回复内容' })}
              onSearch={(value) => setRecordQuery(value)}
              onChange={(value) => {
                if (!value) setRecordQuery('');
              }}
              onClear={() => setRecordQuery('')}
              className='flex-1'
            />
            <Button size='small' status='danger' disabled={records.length === 0} onClick={handleClearRecords}>
              {t('conversation.collab.clearRecords', { defaultValue: '清空' })}
            </Button>
          </div>
          {filteredRecords.length === 0 ? (
            <Empty description={t('conversation.collab.noRecords', { defaultValue: '暂无协作记录' })} />
          ) : (
            <div className='flex flex-col gap-12px max-h-60vh overflow-y-auto'>
              {filteredRecords.map((record) => (
                <div key={record.id} className='flex flex-col gap-2px border-b border-fill-2 pb-8px'>
                  <div className='flex items-center gap-8px text-11px text-t-tertiary'>
                    <span>{new Date(record.created_at).toLocaleString()}</span>
                    <span className='font-medium text-t-secondary'>{record.name}</span>
                  </div>
                  {record.question && (
                    <Text className='text-12px text-t-tertiary'>问：{record.question}</Text>
                  )}
                  {record.error ? (
                    <Text className='text-12px text-red-500'>{record.error}</Text>
                  ) : (
                    <div className='text-13px leading-20px text-t-primary break-words'>
                      <MarkdownView>{record.answer}</MarkdownView>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default CollaboratorPanel;
