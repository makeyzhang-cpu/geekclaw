// 5.0.22 坐席工作台：把会话从 AI 切到自己手里。
//
// 三栏：左侧会话列表 / 中间消息流 / 右侧快捷话术 + 工单。MVP 只覆盖：
// - 列表 agent 全部进行中（state ∈ {ai, human}）的会话
// - 选一个进入右侧消息流；列出全部历史消息（visitor/agent/system + sender_kind）
// - 人工接管 / 转回 AI / 结束会话 三个按钮（按当前 state 启用/禁用）
// - 在 human 态下可以坐席身份发送消息（写入 sender_kind=human）
// - 右侧 cs_notes kind=script 的快捷话术直接插入输入框或一键发送
// - 工单区：从当前会话快速建工单（标题 + 优先级）
//
// 不做：群组/标签/自动分配/转接给其他坐席 — 后续版本迭代。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Empty,
  Input,
  Message,
  Modal,
  Select,
  Spin,
  Tag,
} from '@arco-design/web-react';

// ArcO exposes the multiline input as a member of `Input`, not a top-level export.
const TextArea = Input.TextArea;
import {
  Headset,
  Left,
  Plus,
  Send,
  User,
} from '@icon-park/react';

import { ipcBridge } from '@/common';
import type {
  ICsAgent,
  ICsDialogue,
  ICsMessage,
  ICsNote,
  ICsTicket,
} from '@/common/adapter/ipcBridge';
import { parseCsAgentId, type CsDialogueId } from '@/common/types/ids';

import { useCsAgent, useCsNotes } from './useCsAgents';

// ICsAgent is referenced only via useCsAgent's return type; keep the import
// for documentation/future expansion and silence the unused-import lint.
void (null as ICsAgent | null);

type WorkbenchBubble = {
  cs_message_id: string;
  role: 'visitor' | 'agent' | 'system';
  sender_kind: 'ai' | 'human';
  content: string;
  ts: number;
};

const BubbleView: React.FC<{ bubble: WorkbenchBubble }> = ({ bubble }) => {
  const { t } = useTranslation();
  if (bubble.role === 'system') {
    return (
      <div className='flex w-full justify-center'>
        <span className='px-12px py-4px rd-8px bg-fill-2 text-12px text-t-tertiary'>
          {bubble.content}
        </span>
      </div>
    );
  }
  const isVisitor = bubble.role === 'visitor';
  const isHuman = bubble.role === 'agent' && bubble.sender_kind === 'human';
  // Operator-side messages go on the LEFT to mirror Bytedesk/常见 IM
  // operator consoles (right-side mirror = visitor / left-side = agent).
  const align = isVisitor ? 'justify-end' : 'justify-start';
  const bubbleStyle = isVisitor
    ? 'bg-primary-6 text-white'
    : isHuman
      ? 'bg-success-3 text-t-primary border border-solid border-[rgba(var(--success-6),0.4)]'
      : 'bg-fill-2 text-t-primary';
  const badge = isHuman
    ? t('customerService.workbench.messages.humanBadge', { defaultValue: '人工' })
    : t('customerService.workbench.messages.aiBadge', { defaultValue: 'AI' });
  return (
    <div className={`flex w-full ${align}`}>
      <div className='flex max-w-[76%] flex-col gap-2px'>
        {!isVisitor && (
          <span className='text-11px text-t-tertiary px-4px'>{badge}</span>
        )}
        <div
          className={`box-border px-12px py-8px rd-12px text-13px leading-20px whitespace-pre-wrap break-words ${bubbleStyle}`}
        >
          {bubble.content}
        </div>
      </div>
    </div>
  );
};

const StateTag: React.FC<{ state: ICsDialogue['state'] }> = ({ state }) => {
  const { t } = useTranslation();
  if (state === 'human') {
    return (
      <Tag color='green'>
        {t('customerService.workbench.states.human', { defaultValue: '人工已接管' })}
      </Tag>
    );
  }
  if (state === 'closed') {
    return (
      <Tag color='gray'>
        {t('customerService.workbench.states.closed', { defaultValue: '已结束' })}
      </Tag>
    );
  }
  return (
    <Tag color='arcoblue'>
      {t('customerService.workbench.states.ai', { defaultValue: 'AI 接待中' })}
    </Tag>
  );
};

const OPERATOR_ID_STORAGE_KEY = 'geekclaw.workbench.operator_id';

const useOperatorId = (): [string, (value: string) => void] => {
  // 5.0.22 dev preview: the workbench needs an operator UUIDv7 to take over
  // a dialogue. We persist the last-used value in localStorage and surface a
  // text input in the header so the value is editable without leaving the
  // page. A future release will swap this for a real auth-bound operator id.
  const [op, setOp] = useState<string>('');
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(OPERATOR_ID_STORAGE_KEY);
      if (stored) setOp(stored);
    } catch {
      // localStorage may be unavailable in private windows — fall back to ''.
    }
  }, []);
  const update = useCallback((value: string) => {
    setOp(value);
    try {
      window.localStorage.setItem(OPERATOR_ID_STORAGE_KEY, value);
    } catch {
      /* noop */
    }
  }, []);
  return [op, update];
};

const CsWorkbenchPage: React.FC = () => {
  const { t } = useTranslation();
  const { cs_agent_id: rawAgentId } = useParams<{ cs_agent_id: string }>();
  const navigate = useNavigate();
  const agentId = useMemo(() => (rawAgentId ? parseCsAgentId(rawAgentId) : null), [rawAgentId]);
  const { agent, loading: agentLoading } = useCsAgent(agentId);
  const [operatorId, setOperatorId] = useOperatorId();

  const [dialogues, setDialogues] = useState<ICsDialogue[]>([]);
  const [dialoguesLoading, setDialoguesLoading] = useState(false);
  const [activeDialogue, setActiveDialogue] = useState<ICsDialogue | null>(null);
  const [messages, setMessages] = useState<WorkbenchBubble[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Right pane: notes for script-quick-replies + tickets.
  const { notes } = useCsNotes(agentId);
  const scripts = useMemo(
    () => notes.filter((note) => note.enabled && note.kind === 'script'),
    [notes],
  );
  const [tickets, setTickets] = useState<ICsTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);

  const messageScrollRef = useRef<HTMLDivElement | null>(null);

  const loadDialogues = useCallback(async () => {
    if (!agentId) return;
    setDialoguesLoading(true);
    try {
      const list = await ipcBridge.customerService.listActiveDialogues.invoke({
        cs_agent_id: agentId,
      });
      setDialogues(list);
    } catch (err) {
      console.error('workbench: loadDialogues failed', err);
      setError(String(err));
    } finally {
      setDialoguesLoading(false);
    }
  }, [agentId]);

  const loadMessages = useCallback(async (dialogueId: CsDialogueId) => {
    setMessagesLoading(true);
    try {
      const list = await ipcBridge.customerService.listDialogueMessages.invoke({
        cs_dialogue_id: dialogueId,
      });
      setMessages(
        list
          .filter((m) => m.role === 'visitor' || m.role === 'agent' || m.role === 'system')
          .map((m) => ({
            cs_message_id: m.cs_message_id,
            role: m.role,
            sender_kind: m.sender_kind,
            content: m.content,
            ts: m.created_at,
          })),
      );
    } catch (err) {
      console.error('workbench: loadMessages failed', err);
      setError(String(err));
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  const loadTickets = useCallback(async () => {
    if (!agentId) return;
    setTicketsLoading(true);
    try {
      const list = await ipcBridge.customerService.listTickets.invoke({
        cs_agent_id: agentId,
        limit: 50,
      });
      setTickets(list);
    } catch (err) {
      console.error('workbench: loadTickets failed', err);
    } finally {
      setTicketsLoading(false);
    }
  }, [agentId]);

  // Initial load: dialogues + tickets. Messages load when a dialogue is picked.
  useEffect(() => {
    void loadDialogues();
    void loadTickets();
  }, [loadDialogues, loadTickets]);

  useEffect(() => {
    if (!activeDialogue) {
      setMessages([]);
      return;
    }
    void loadMessages(activeDialogue.cs_dialogue_id);
  }, [activeDialogue, loadMessages]);

  // Auto-scroll to bottom on message updates.
  useEffect(() => {
    const el = messageScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);  const refreshDialogueState = useCallback(
    async (dialogueId: string): Promise<ICsDialogue | null> => {
      try {
        const all = await ipcBridge.customerService.listActiveDialogues.invoke({
          cs_agent_id: agentId!,
        });
        const next = all.find((row) => row.cs_dialogue_id === dialogueId) ?? null;
        setDialogues(all);
        setActiveDialogue(next);
        return next;
      } catch (err) {
        console.error('workbench: refreshDialogueState failed', err);
        return null;
      }
    },
    [agentId],
  );

  const takeOver = useCallback(async () => {
    if (!activeDialogue) return;
    if (!operatorId) {
      Message.warning(t('customerService.workbench.operatorPlaceholder', { defaultValue: '操作员 UUIDv7' }));
      return;
    }
    try {
      await ipcBridge.customerService.takeoverDialogue.invoke({
        cs_dialogue_id: activeDialogue.cs_dialogue_id,
        operator_id: operatorId,
      });
      Message.success(t('customerService.workbench.actions.takeover', { defaultValue: '人工接管' }));
      await refreshDialogueState(activeDialogue.cs_dialogue_id);
      await loadMessages(activeDialogue.cs_dialogue_id);
    } catch (err) {
      console.error('takeover failed', err);
      Message.error(String(err));
    }
  }, [activeDialogue, operatorId, refreshDialogueState, loadMessages, t]);

  const release = useCallback(async () => {
    if (!activeDialogue) return;
    try {
      await ipcBridge.customerService.releaseDialogue.invoke({
        cs_dialogue_id: activeDialogue.cs_dialogue_id,
      });
      Message.success(t('customerService.workbench.actions.release', { defaultValue: '转回 AI' }));
      await refreshDialogueState(activeDialogue.cs_dialogue_id);
      await loadMessages(activeDialogue.cs_dialogue_id);
    } catch (err) {
      console.error('release failed', err);
      Message.error(String(err));
    }
  }, [activeDialogue, refreshDialogueState, loadMessages, t]);

  const close = useCallback(() => {
    if (!activeDialogue) return;
    Modal.confirm({
      title: t('customerService.workbench.actions.close', { defaultValue: '结束会话' }),
      content: t('customerService.workbench.actions.close', { defaultValue: '结束会话' }),
      onOk: async () => {
        try {
          await ipcBridge.customerService.closeDialogue.invoke({
            cs_dialogue_id: activeDialogue.cs_dialogue_id,
          });
          Message.success(t('customerService.workbench.actions.close', { defaultValue: '结束会话' }));
          await loadDialogues();
          setActiveDialogue(null);
        } catch (err) {
          console.error('close failed', err);
          Message.error(String(err));
        }
      },
    });
  }, [activeDialogue, loadDialogues, t]);

  const sendHuman = useCallback(async () => {
    if (!activeDialogue) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      Message.warning(t('customerService.workbench.messages.humanPlaceholder', { defaultValue: '以坐席身份向访客发送…' }));
      return;
    }
    if (activeDialogue.state === 'closed') {
      Message.warning(t('customerService.workbench.states.closed', { defaultValue: '已结束' }));
      return;
    }
    if (activeDialogue.state !== 'human') {
      Message.warning(t('customerService.workbench.actions.takeover', { defaultValue: '人工接管' }));
      return;
    }
    setSending(true);
    try {
      await ipcBridge.customerService.postHumanMessage.invoke({
        cs_dialogue_id: activeDialogue.cs_dialogue_id,
        text: trimmed,
      });
      setDraft('');
      await loadMessages(activeDialogue.cs_dialogue_id);
    } catch (err) {
      console.error('sendHuman failed', err);
      Message.error(String(err));
    } finally {
      setSending(false);
    }
  }, [activeDialogue, draft, loadMessages, t]);

  const sendScript = useCallback(
    async (note: ICsNote) => {
      if (!activeDialogue) return;
      if (activeDialogue.state !== 'human') {
        // Not in human mode — auto-promote so the operator can ship the
        // script immediately. Single click is friendlier than gating on a
        // "first takeover" click.
        if (!operatorId) {
          Message.warning(
            t('customerService.workbench.operatorPlaceholder', { defaultValue: '操作员 UUIDv7' }),
          );
          return;
        }
        try {
          await ipcBridge.customerService.takeoverDialogue.invoke({
            cs_dialogue_id: activeDialogue.cs_dialogue_id,
            operator_id: operatorId,
          });
        } catch (err) {
          Message.error(String(err));
          return;
        }
      }
      setSending(true);
      try {
        await ipcBridge.customerService.postHumanMessage.invoke({
          cs_dialogue_id: activeDialogue.cs_dialogue_id,
          text: note.content,
        });
        await refreshDialogueState(activeDialogue.cs_dialogue_id);
        await loadMessages(activeDialogue.cs_dialogue_id);
      } catch (err) {
        Message.error(String(err));
      } finally {
        setSending(false);
      }
    },
    [activeDialogue, operatorId, refreshDialogueState, loadMessages, t],
  );

  const openCreateTicket = useCallback(() => {
    if (!activeDialogue || !agentId) return;
    Modal.confirm({
      title: t('customerService.workbench.tickets.createFromHere', { defaultValue: '为当前会话建工单' }),
      content: (
        <CreateTicketForm
          initialVisitor={activeDialogue.channel_user_id}
          onSubmit={async (input) => {
            try {
              const created = await ipcBridge.customerService.createTicket.invoke({
                ...input,
                cs_dialogue_id: activeDialogue.cs_dialogue_id,
                cs_agent_id: agentId,
              });
              Message.success(
                t('customerService.tickets.actions.created', { defaultValue: '工单已创建' }),
              );
              await loadTickets();
              return created.cs_ticket_id;
            } catch (err) {
              Message.error(String(err));
              throw err;
            }
          }}
        />
      ),
      onOk: async () => {
        // Form is self-submitting; Modal.confirm OK button is just a dismiss.
        await loadTickets();
      },
      okText: t('customerService.tickets.actions.save', { defaultValue: '保存' }),
      cancelText: t('common.cancel', { defaultValue: '取消' }),
    });
  }, [activeDialogue, agentId, loadTickets, t]);

  if (!agentId) {
    return <Empty description='invalid agent id' />;
  }
  if (agentLoading || !agent) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <Spin />
      </div>
    );
  }

  return (
    <div className='flex h-full w-full flex-col box-border bg-bg-1'>
      <div className='flex shrink-0 items-center gap-12px border-b border-solid border-[var(--color-border-2)] px-16px py-10px'>
        <Button
          size='small'
          type='text'
          onClick={() => void navigate(`/customer-service/${agent.cs_agent_id}`)}
        >
          <span className='inline-flex items-center gap-4px'>
            <Left theme='outline' size='14' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
            {t('customerService.workbench.back', { defaultValue: '返回客服' })}
          </span>
        </Button>
        <span className='text-15px font-500'>{agent.name}</span>
        <span className='text-12px text-t-tertiary'>
          {t('customerService.workbench.subtitle', { defaultValue: '把会话从 AI 切到自己手里 — 接管后引擎不再回复。' })}
        </span>
        <span className='ml-auto inline-flex items-center gap-4px text-12px text-t-tertiary'>
          <User theme='outline' size='14' fill='currentColor' />
          <Input
            size='mini'
            style={{ width: '260px' }}
            value={operatorId}
            onChange={setOperatorId}
            placeholder={t('customerService.workbench.operatorPlaceholder', {
              defaultValue: '操作员 UUIDv7',
            })}
          />
        </span>
      </div>

      {error && (
        <div className='px-16px py-8px bg-danger-1 text-12px text-danger-6'>{error}</div>
      )}

      <div className='flex grow min-h-0'>
        {/* Left: dialogue list */}
        <div className='flex shrink-0 w-260px flex-col border-r border-solid border-[var(--color-border-2)]'>
          <div className='shrink-0 px-12px py-8px text-12px text-t-tertiary'>
            {t('customerService.workbench.title', { defaultValue: '坐席工作台' })}
            <span className='ml-4px'>{dialogues.length}</span>
          </div>
          <div className='grow min-h-0 overflow-y-auto'>
            {dialoguesLoading ? (
              <div className='flex h-full items-center justify-center'>
                <Spin />
              </div>
            ) : dialogues.length === 0 ? (
              <Empty
                description={t('customerService.workbench.empty', { defaultValue: '暂无进行中的会话' })}
              />
            ) : (
              dialogues.map((dialogue) => {
                const selected =
                  activeDialogue?.cs_dialogue_id === dialogue.cs_dialogue_id;
                return (
                  <div
                    key={dialogue.cs_dialogue_id}
                    onClick={() => setActiveDialogue(dialogue)}
                    className={`flex cursor-pointer flex-col gap-4px border-b border-solid border-[var(--color-border-1)] px-12px py-10px ${
                      selected ? 'bg-primary-1' : 'hover:bg-fill-1'
                    }`}
                  >
                    <div className='flex items-center justify-between gap-4px'>
                      <span className='truncate text-13px font-500'>
                        {dialogue.channel_user_id.slice(0, 8)}…
                      </span>
                      <StateTag state={dialogue.state} />
                    </div>
                    <span className='truncate text-11px text-t-tertiary'>
                      {dialogue.chat_id}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Middle: message stream + composer */}
        <div className='flex grow min-w-0 flex-col'>
          {!activeDialogue ? (
            <div className='flex h-full items-center justify-center'>
              <Empty
                description={t('customerService.workbench.empty', { defaultValue: '暂无进行中的会话' })}
              />
            </div>
          ) : (
            <>
              <div className='flex shrink-0 items-center gap-8px px-16px py-8px border-b border-solid border-[var(--color-border-2)]'>
                <StateTag state={activeDialogue.state} />
                {activeDialogue.taken_by && (
                  <span className='text-11px text-t-tertiary'>
                    {activeDialogue.taken_by.slice(0, 8)}…
                  </span>
                )}
                <span className='ml-auto flex gap-6px'>
                  {activeDialogue.state === 'ai' && (
                    <Button
                      size='mini'
                      type='primary'
                      onClick={() => void takeOver()}
                      disabled={!operatorId}
                    >
                      {t('customerService.workbench.actions.takeover', { defaultValue: '人工接管' })}
                    </Button>
                  )}
                  {activeDialogue.state === 'human' && (
                    <>
                      <Button
                        size='mini'
                        onClick={() => void release()}
                      >
                        {t('customerService.workbench.actions.release', { defaultValue: '转回 AI' })}
                      </Button>
                      <Button
                        size='mini'
                        type='primary'
                        onClick={openCreateTicket}
                      >
                        <span className='inline-flex items-center gap-4px'>
                          <Plus theme='outline' size='12' fill='currentColor' />
                          {t('customerService.workbench.actions.createTicket', { defaultValue: '建工单' })}
                        </span>
                      </Button>
                    </>
                  )}
                  {activeDialogue.state !== 'closed' && (
                    <Button size='mini' status='danger' onClick={close}>
                      {t('customerService.workbench.actions.close', { defaultValue: '结束会话' })}
                    </Button>
                  )}
                </span>
              </div>
              <div
                ref={messageScrollRef}
                className='grow min-h-0 overflow-y-auto px-16px py-12px'
                style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
              >
                {messagesLoading ? (
                  <div className='flex h-full items-center justify-center'>
                    <Spin />
                  </div>
                ) : messages.length === 0 ? (
                  <Empty />
                ) : (
                  messages.map((b) => (
                    <BubbleView key={b.cs_message_id} bubble={b} />
                  ))
                )}
              </div>
              <div className='shrink-0 border-t border-solid border-[var(--color-border-2)] px-16px py-10px'>
                <TextArea
                  value={draft}
                  onChange={setDraft}
                  placeholder={t('customerService.workbench.messages.humanPlaceholder', {
                    defaultValue: '以坐席身份向访客发送…',
                  })}
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  disabled={activeDialogue.state !== 'human' || sending}
                  onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      void sendHuman();
                    }
                  }}
                />
                <div className='mt-8px flex items-center gap-8px'>
                  <span className='text-11px text-t-tertiary'>
                    {t('customerService.workbench.messages.sendHint', {
                      defaultValue: 'Enter 发送 / Shift+Enter 换行',
                    })}
                  </span>
                  <Button
                    size='small'
                    type='primary'
                    loading={sending}
                    disabled={activeDialogue.state !== 'human'}
                    onClick={() => void sendHuman()}
                    className='ml-auto'
                  >
                    <span className='inline-flex items-center gap-4px'>
                      <Send theme='outline' size='14' fill='currentColor' />
                      {t('customerService.workbench.actions.sendHuman', { defaultValue: '发送（人工）' })}
                    </span>
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right: scripts + tickets */}
        <div className='flex shrink-0 w-300px flex-col border-l border-solid border-[var(--color-border-2)]'>
          <div className='shrink-0 px-12px py-8px text-12px text-t-tertiary border-b border-solid border-[var(--color-border-1)]'>
            {t('customerService.workbench.scripts.title', { defaultValue: '快捷回复' })}
          </div>
          <div className='shrink-0 max-h-40vh overflow-y-auto'>
            {scripts.length === 0 ? (
              <div className='px-12px py-8px text-12px text-t-tertiary'>
                {t('customerService.workbench.scripts.empty', {
                  defaultValue: '还没有快捷话术',
                })}
              </div>
            ) : (
              scripts.map((note) => (
                <div
                  key={note.cs_note_id}
                  className='flex items-start gap-6px border-b border-solid border-[var(--color-border-1)] px-12px py-8px hover:bg-fill-1'
                >
                  <span className='grow text-12px text-t-primary whitespace-pre-wrap break-words'>
                    {note.content}
                  </span>
                  <Button
                    size='mini'
                    type='text'
                    onClick={() => void sendScript(note)}
                    disabled={!activeDialogue || activeDialogue.state === 'closed'}
                  >
                    <Send theme='outline' size='12' fill='currentColor' />
                  </Button>
                </div>
              ))
            )}
          </div>
          <div className='shrink-0 px-12px py-8px text-12px text-t-tertiary border-y border-solid border-[var(--color-border-1)] flex items-center gap-4px'>
            <Headset theme='outline' size='14' />
            {t('customerService.workbench.tickets.title', { defaultValue: '相关工单' })}
            <span className='ml-auto'>{tickets.length}</span>
          </div>
          <div className='grow min-h-0 overflow-y-auto'>
            {ticketsLoading ? (
              <div className='flex h-full items-center justify-center'>
                <Spin />
              </div>
            ) : tickets.length === 0 ? (
              <div className='px-12px py-8px text-12px text-t-tertiary'>
                {t('customerService.workbench.tickets.title', { defaultValue: '相关工单' })} -
              </div>
            ) : (
              tickets.map((ticket) => (
                <div
                  key={ticket.cs_ticket_id}
                  className='border-b border-solid border-[var(--color-border-1)] px-12px py-8px'
                >
                  <div className='flex items-center justify-between gap-4px'>
                    <span className='truncate text-13px font-500'>{ticket.title}</span>
                    <Tag
                      color={
                        ticket.status === 'pending'
                          ? 'orange'
                          : ticket.status === 'in_progress'
                            ? 'arcoblue'
                            : ticket.status === 'resolved'
                              ? 'green'
                              : 'gray'
                      }
                    >
                      {ticket.status}
                    </Tag>
                  </div>
                  {ticket.description && (
                    <p className='mt-4px text-12px text-t-secondary whitespace-pre-wrap break-words line-clamp-2'>
                      {ticket.description}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const CreateTicketForm: React.FC<{
  initialVisitor: string;
  onSubmit: (input: {
    title: string;
    description?: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    visitor_name?: string;
    visitor_handle?: string;
  }) => Promise<string>;
}> = ({ initialVisitor, onSubmit }) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [submitting, setSubmitting] = useState(false);
  const submitRef = useRef<() => void>(() => undefined);

  // Push submit down to the parent's onOk flow via a window-level glue:
  // simplest — wire into Modal's onOk by exposing a global on this form via
  // useEffect. We avoid that complexity by relying on Modal.confirm's default
  // OK button to call onOk which closes the dialog; submission happens here
  // on a "提交" button INSIDE the form via a side-effect. The Modal's own OK
  // button just confirms the form filled in the ticket, then we re-load.
  useEffect(() => {
    submitRef.current = async () => {
      if (!title.trim()) {
        Message.warning(
          t('customerService.tickets.fields.titleRequired', { defaultValue: '请输入工单标题' }),
        );
        throw new Error('title required');
      }
      setSubmitting(true);
      try {
        await onSubmit({
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          visitor_handle: initialVisitor,
        });
      } finally {
        setSubmitting(false);
      }
    };
  }, [title, description, priority, onSubmit, initialVisitor, t]);

  return (
    <div className='flex flex-col gap-8px'>
      <Input
        value={title}
        onChange={setTitle}
        placeholder={t('customerService.tickets.fields.titlePlaceholder', {
          defaultValue: '例如：客户要求退款',
        })}
      />
      <TextArea
        value={description}
        onChange={setDescription}
        autoSize={{ minRows: 2, maxRows: 4 }}
        placeholder={t('customerService.tickets.fields.descriptionPlaceholder', {
          defaultValue: '补充背景、已尝试的步骤、需要的资源…',
        })}
      />
      <Select
        value={priority}
        onChange={(value) => setPriority(value as 'low' | 'normal' | 'high' | 'urgent')}
      >
        <Select.Option value='low'>
          {t('customerService.tickets.fields.priorityLow', { defaultValue: '低' })}
        </Select.Option>
        <Select.Option value='normal'>
          {t('customerService.tickets.fields.priorityNormal', { defaultValue: '普通' })}
        </Select.Option>
        <Select.Option value='high'>
          {t('customerService.tickets.fields.priorityHigh', { defaultValue: '高' })}
        </Select.Option>
        <Select.Option value='urgent'>
          {t('customerService.tickets.fields.priorityUrgent', { defaultValue: '紧急' })}
        </Select.Option>
      </Select>
      <Button
        type='primary'
        loading={submitting}
        onClick={() => void submitRef.current()}
      >
        {t('customerService.tickets.actions.create', { defaultValue: '创建' })}
      </Button>
    </div>
  );
};

export default CsWorkbenchPage;
