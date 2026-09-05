// 5.0.28 统一收件箱（聚合 AI 客服）—— 把会话从 AI 切到自己手里。
//
// 三栏：左侧跨客服聚合会话列表 / 中间消息流 / 右侧快捷话术 + 工单。相对 5.0.22 的
// 变化：会话列表不再按单一客服查询，而是走 `/api/customer-service/inbox` 聚合
// 全部客服、全部渠道（微信/企微/WhatsApp/LINE/Email/Telegram/…），让 AI 真正接管
// 通讯渠道、代替本人与粉丝/客户对话，而不是本地"自己跟自己聊"。
//
// - 列表项显示：访客昵称（回退 channel_user_id）、渠道平台徽标、接待客服名、
//   最后一条消息预览、会话状态。
// - 顶部支持「客服」「渠道」「状态」三组筛选（跨客服聚合）。
// - 人工接管 / 转回 AI / 结束会话 三个按钮（按当前 state 启用/禁用）。
// - 在 human 态下可以坐席身份发送消息（写入 sender_kind=human）。
// - 右侧 cs_notes kind=script 的快捷话术直接插入输入框或一键发送。
// - 工单区：从当前会话快速建工单（标题 + 优先级）。
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
  Tabs,
} from '@arco-design/web-react';

// ArcO exposes the multiline input as a member of `Input`, not a top-level export.
const TextArea = Input.TextArea;
import {
  Api,
  Headset,
  ListView,
  Plus,
  Send,
  Ticket,
  User,
} from '@icon-park/react';

import { ipcBridge } from '@/common';
import type {
  ICsInboxItem,
  ICsNote,
  ICsTicket,
} from '@/common/adapter/ipcBridge';
import { parseCsAgentId, type CsAgentId, type CsDialogueId } from '@/common/types/ids';

import { useCsAgents, useCsNotes } from './useCsAgents';

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

type DialogueState = 'ai' | 'human' | 'closed';

const StateTag: React.FC<{ state: DialogueState }> = ({ state }) => {
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

/** 渠道平台徽标：用平台 type 映射一个稳定的颜色，收件箱里一眼区分渠道来源。 */
const ChannelBadge: React.FC<{ type: string }> = ({ type }) => {
  const color = useMemo(() => {
    const key = (type || '').toLowerCase();
    if (key.includes('wechat') || key.includes('weixin') || key.includes('wecom')) return 'green';
    if (key.includes('whatsapp')) return 'green';
    if (key.includes('line')) return 'green';
    if (key.includes('email') || key.includes('mail')) return 'orange';
    if (key.includes('telegram') || key.includes('tg')) return 'arcoblue';
    if (key.includes('sms')) return 'gray';
    return 'gray';
  }, [type]);
  return (
    <Tag size='small' color={color} className='shrink-0'>
      {type || 'unknown'}
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
  // The URL agent id (when routed from a roster card) pre-filters the unified
  // inbox to that agent; the `/customer-service/workbench` route has no id and
  // defaults to the cross-agent view.
  const initialAgentFilter = useMemo(
    () => (rawAgentId ? parseCsAgentId(rawAgentId) : null),
    [rawAgentId],
  );
  const { agents } = useCsAgents();
  const [operatorId, setOperatorId] = useOperatorId();

  type StateFilter = 'all' | DialogueState;
  const FILTER_OPTIONS: { key: StateFilter; label: string }[] = [
    { key: 'all', label: t('customerService.workbench.filters.all', { defaultValue: '全部' }) },
    { key: 'ai', label: t('customerService.workbench.filters.ai', { defaultValue: 'AI 接待' }) },
    { key: 'human', label: t('customerService.workbench.filters.human', { defaultValue: '人工' }) },
    { key: 'closed', label: t('customerService.workbench.filters.closed', { defaultValue: '已结束' }) },
  ];

  const [inbox, setInbox] = useState<ICsInboxItem[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [agentFilter, setAgentFilter] = useState<CsAgentId | 'all'>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [activeItem, setActiveItem] = useState<ICsInboxItem | null>(null);
  const [messages, setMessages] = useState<WorkbenchBubble[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the agent filter from the URL param once agents/param are ready.
  useEffect(() => {
    if (initialAgentFilter) setAgentFilter(initialAgentFilter);
  }, [initialAgentFilter]);

  // Distinct channel platforms present in the current inbox (for the filter).
  const channelTypes = useMemo(() => {
    const set = new Set<string>();
    for (const item of inbox) set.add(item.channel_type);
    return [...set].sort();
  }, [inbox]);

  const filteredItems = useMemo(() => {
    return inbox.filter((item) => {
      if (stateFilter !== 'all' && item.state !== stateFilter) return false;
      if (agentFilter !== 'all' && item.cs_agent_id !== agentFilter) return false;
      if (channelFilter !== 'all' && item.channel_type !== channelFilter) return false;
      return true;
    });
  }, [inbox, stateFilter, agentFilter, channelFilter]);

  const { notes } = useCsNotes(activeItem ? activeItem.cs_agent_id : null);
  const scripts = useMemo(
    () => notes.filter((note) => note.enabled && note.kind === 'script'),
    [notes],
  );
  const [tickets, setTickets] = useState<ICsTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);

  const messageScrollRef = useRef<HTMLDivElement | null>(null);

  const loadInbox = useCallback(async () => {
    setInboxLoading(true);
    try {
      const list = await ipcBridge.customerService.listInbox.invoke({ limit: 500 });
      setInbox(list);
    } catch (err) {
      console.error('workbench: loadInbox failed', err);
      setError(String(err));
    } finally {
      setInboxLoading(false);
    }
  }, []);

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

  const loadTickets = useCallback(async (csAgentId?: CsAgentId | null) => {
    if (!csAgentId) {
      setTickets([]);
      return;
    }
    setTicketsLoading(true);
    try {
      const list = await ipcBridge.customerService.listTickets.invoke({
        cs_agent_id: csAgentId,
        limit: 50,
      });
      setTickets(list);
    } catch (err) {
      console.error('workbench: loadTickets failed', err);
    } finally {
      setTicketsLoading(false);
    }
  }, []);

  // Initial load: unified inbox (cross-agent).
  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    if (!activeItem) {
      setMessages([]);
      return;
    }
    void loadMessages(activeItem.cs_dialogue_id);
  }, [activeItem, loadMessages]);

  useEffect(() => {
    if (!activeItem) {
      setTickets([]);
      return;
    }
    void loadTickets(activeItem.cs_agent_id);
  }, [activeItem, loadTickets]);

  // Auto-scroll to bottom on message updates.
  useEffect(() => {
    const el = messageScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const refreshDialogueState = useCallback(
    async (dialogueId: string): Promise<ICsInboxItem | null> => {
      try {
        const all = await ipcBridge.customerService.listInbox.invoke({ limit: 500 });
        const next = all.find((row) => row.cs_dialogue_id === dialogueId) ?? null;
        setInbox(all);
        setActiveItem(next);
        return next;
      } catch (err) {
        console.error('workbench: refreshDialogueState failed', err);
        return null;
      }
    },
    [],
  );

  const takeOver = useCallback(async () => {
    if (!activeItem) return;
    if (!operatorId) {
      Message.warning(t('customerService.workbench.operatorPlaceholder', { defaultValue: '操作员 UUIDv7' }));
      return;
    }
    try {
      await ipcBridge.customerService.takeoverDialogue.invoke({
        cs_dialogue_id: activeItem.cs_dialogue_id,
        operator_id: operatorId,
      });
      Message.success(t('customerService.workbench.actions.takeover', { defaultValue: '人工接管' }));
      await refreshDialogueState(activeItem.cs_dialogue_id);
      await loadMessages(activeItem.cs_dialogue_id);
    } catch (err) {
      console.error('takeover failed', err);
      Message.error(String(err));
    }
  }, [activeItem, operatorId, refreshDialogueState, loadMessages, t]);

  const release = useCallback(async () => {
    if (!activeItem) return;
    try {
      await ipcBridge.customerService.releaseDialogue.invoke({
        cs_dialogue_id: activeItem.cs_dialogue_id,
      });
      Message.success(t('customerService.workbench.actions.release', { defaultValue: '转回 AI' }));
      await refreshDialogueState(activeItem.cs_dialogue_id);
      await loadMessages(activeItem.cs_dialogue_id);
    } catch (err) {
      console.error('release failed', err);
      Message.error(String(err));
    }
  }, [activeItem, refreshDialogueState, loadMessages, t]);

  const close = useCallback(() => {
    if (!activeItem) return;
    Modal.confirm({
      title: t('customerService.workbench.actions.close', { defaultValue: '结束会话' }),
      content: t('customerService.workbench.actions.close', { defaultValue: '结束会话' }),
      onOk: async () => {
        try {
          await ipcBridge.customerService.closeDialogue.invoke({
            cs_dialogue_id: activeItem.cs_dialogue_id,
          });
          Message.success(t('customerService.workbench.actions.close', { defaultValue: '结束会话' }));
          await loadInbox();
          setActiveItem(null);
        } catch (err) {
          console.error('close failed', err);
          Message.error(String(err));
        }
      },
    });
  }, [activeItem, loadInbox, t]);

  const sendHuman = useCallback(async () => {
    if (!activeItem) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      Message.warning(t('customerService.workbench.messages.humanPlaceholder', { defaultValue: '以坐席身份向访客发送…' }));
      return;
    }
    if (activeItem.state === 'closed') {
      Message.warning(t('customerService.workbench.states.closed', { defaultValue: '已结束' }));
      return;
    }
    if (activeItem.state !== 'human') {
      Message.warning(t('customerService.workbench.actions.takeover', { defaultValue: '人工接管' }));
      return;
    }
    setSending(true);
    try {
      await ipcBridge.customerService.postHumanMessage.invoke({
        cs_dialogue_id: activeItem.cs_dialogue_id,
        text: trimmed,
      });
      setDraft('');
      await loadMessages(activeItem.cs_dialogue_id);
    } catch (err) {
      console.error('sendHuman failed', err);
      Message.error(String(err));
    } finally {
      setSending(false);
    }
  }, [activeItem, draft, loadMessages, t]);

  const sendScript = useCallback(
    async (note: ICsNote) => {
      if (!activeItem) return;
      if (activeItem.state !== 'human') {
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
            cs_dialogue_id: activeItem.cs_dialogue_id,
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
          cs_dialogue_id: activeItem.cs_dialogue_id,
          text: note.content,
        });
        await refreshDialogueState(activeItem.cs_dialogue_id);
        await loadMessages(activeItem.cs_dialogue_id);
      } catch (err) {
        Message.error(String(err));
      } finally {
        setSending(false);
      }
    },
    [activeItem, operatorId, refreshDialogueState, loadMessages, t],
  );

  const openCreateTicket = useCallback(() => {
    if (!activeItem) return;
    Modal.confirm({
      title: t('customerService.workbench.tickets.createFromHere', { defaultValue: '为当前会话建工单' }),
      content: (
        <CreateTicketForm
          initialVisitor={activeItem.channel_user_id}
          onSubmit={async (input) => {
            try {
              const created = await ipcBridge.customerService.createTicket.invoke({
                ...input,
                cs_dialogue_id: activeItem.cs_dialogue_id,
                cs_agent_id: activeItem.cs_agent_id,
              });
              Message.success(
                t('customerService.tickets.actions.created', { defaultValue: '工单已创建' }),
              );
              await loadTickets(activeItem.cs_agent_id);
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
        await loadTickets(activeItem.cs_agent_id);
      },
      okText: t('customerService.tickets.actions.save', { defaultValue: '保存' }),
      cancelText: t('common.cancel', { defaultValue: '取消' }),
    });
  }, [activeItem, loadTickets, t]);

  const visitorName = (item: ICsInboxItem): string =>
    item.visitor_name && item.visitor_name.trim()
      ? item.visitor_name
      : item.channel_user_id;

  return (
    <div className='flex h-full w-full flex-col box-border bg-bg-1'>
      <div className='flex shrink-0 items-center gap-12px border-b border-solid border-[var(--color-border-2)] px-16px py-10px'>
        {/* 客服管理 + 收件箱标题 */}
        <Button
          size='small'
          type='text'
          onClick={() => void navigate('/customer-service/roster')}
        >
          <span className='inline-flex items-center gap-4px'>
            <ListView theme='outline' size='14' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
            {t('customerService.workbench.manageAgents', { defaultValue: '客服管理' })}
          </span>
        </Button>

        <span className='inline-flex items-center gap-6px text-15px font-500'>
          <Headset theme='outline' size='15' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
          {t('customerService.workbench.inboxTitle', { defaultValue: '统一收件箱' })}
        </span>
        <span className='text-12px text-t-tertiary'>
          {t('customerService.workbench.inboxSubtitle', {
            defaultValue: '聚合全部客服与渠道 — AI 接管通讯，代替本人与粉丝/客户对话。',
          })}
        </span>

        {/* 客服 / 渠道 筛选 */}
        <span className='ml-auto inline-flex items-center gap-8px'>
          <Select
            size='small'
            style={{ width: 140 }}
            value={agentFilter}
            onChange={(value: unknown) => setAgentFilter((value as CsAgentId) || 'all')}
          >
            <Select.Option value='all'>
              {t('customerService.workbench.filters.allAgents', { defaultValue: '全部客服' })}
            </Select.Option>
            {agents.map((a) => (
              <Select.Option key={a.cs_agent_id} value={a.cs_agent_id}>
                <span className='inline-flex items-center gap-6px'>
                  <span
                    className={`w-6px h-6px rounded-full ${a.enabled ? 'bg-green-6' : 'bg-gray-4'}`}
                  />
                  <span className='truncate'>{a.name}</span>
                </span>
              </Select.Option>
            ))}
          </Select>
          <Select
            size='small'
            style={{ width: 130 }}
            value={channelFilter}
            onChange={(value: unknown) => setChannelFilter((value as string) || 'all')}
          >
            <Select.Option value='all'>
              {t('customerService.workbench.filters.allChannels', { defaultValue: '全部渠道' })}
            </Select.Option>
            {channelTypes.map((ct) => (
              <Select.Option key={ct} value={ct}>
                {ct}
              </Select.Option>
            ))}
          </Select>
        </span>

        {/* 渠道中心 + 工单 + 操作员 */}
        <span className='inline-flex items-center gap-8px'>
          <Button size='small' type='text' onClick={() => void navigate('/customer-service/channels')}>
            <span className='inline-flex items-center gap-4px'>
              <Api theme='outline' size='14' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
              {t('customerService.channels.openChannels', { defaultValue: '渠道中心' })}
            </span>
          </Button>
          <Button size='small' type='text' onClick={() => void navigate('/customer-service/tickets')}>
            <span className='inline-flex items-center gap-4px'>
              <Ticket theme='outline' size='14' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
              {t('customerService.tickets.openTickets', { defaultValue: '工单' })}
            </span>
          </Button>
          <span className='inline-flex items-center gap-4px text-12px text-t-tertiary'>
            <User theme='outline' size='14' fill='currentColor' />
            <Input
              size='mini'
              style={{ width: '200px' }}
              value={operatorId}
              onChange={setOperatorId}
              placeholder={t('customerService.workbench.operatorPlaceholder', {
                defaultValue: '操作员 UUIDv7',
              })}
            />
          </span>
        </span>
      </div>

      {error && (
        <div className='px-16px py-8px bg-danger-1 text-12px text-danger-6'>{error}</div>
      )}

      <div className='flex grow min-h-0'>
        {/* Left: unified inbox list with Bytedesk-style filter tabs */}
        <div className='flex shrink-0 w-300px flex-col border-r border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)]'>
          <div className='shrink-0 px-12px py-10px border-b border-solid border-[var(--color-border-2)]'>
            <div className='text-13px font-600 text-t-primary mb-8px'>
              {t('customerService.workbench.title', { defaultValue: '会话' })}
              <span className='ml-6px text-12px font-400 text-t-tertiary'>{filteredItems.length}</span>
            </div>
            <div className='flex flex-wrap gap-6px'>
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type='button'
                  onClick={() => setStateFilter(opt.key)}
                  className={`px-8px py-3px rd-10px text-11px border border-solid transition-colors ${
                    stateFilter === opt.key
                      ? 'bg-primary-6 border-primary-6 text-white'
                      : 'bg-transparent border-[var(--color-border-2)] text-t-secondary hover:border-primary-6 hover:text-primary-6'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className='grow min-h-0 overflow-y-auto'>
            {inboxLoading ? (
              <div className='flex h-full items-center justify-center'>
                <Spin />
              </div>
            ) : filteredItems.length === 0 ? (
              <Empty
                description={t('customerService.workbench.emptyUnified', { defaultValue: '暂无会话' })}
              />
            ) : (
              filteredItems.map((item) => {
                const selected = activeItem?.cs_dialogue_id === item.cs_dialogue_id;
                const name = visitorName(item);
                return (
                  <div
                    key={item.cs_dialogue_id}
                    onClick={() => setActiveItem(item)}
                    className={`flex cursor-pointer flex-col gap-4px border-b border-solid border-[var(--color-border-1)] px-12px py-10px ${
                      selected ? 'bg-primary-1' : 'hover:bg-fill-1'
                    }`}
                  >
                    <div className='flex items-center justify-between gap-8px'>
                      <span className='truncate text-13px font-500 min-w-0'>
                        {name.length > 22 ? `${name.slice(0, 22)}…` : name}
                      </span>
                      <span className='shrink-0 text-11px text-t-quaternary'>
                        {new Date(item.last_activity).toLocaleDateString()}
                      </span>
                    </div>
                    <div className='flex items-center justify-between gap-8px'>
                      <span className='truncate text-11px text-t-tertiary min-w-0'>
                        {item.last_message_preview && item.last_message_preview.trim()
                          ? item.last_message_preview
                          : item.chat_id}
                      </span>
                      <StateTag state={item.state} />
                    </div>
                    <div className='flex items-center gap-6px'>
                      <ChannelBadge type={item.channel_type} />
                      <span className='truncate text-11px text-t-tertiary min-w-0'>
                        {item.agent_name || item.cs_agent_id}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Middle: message stream + composer */}
        <div className='flex grow min-w-0 flex-col'>
          {!activeItem ? (
            <div className='flex h-full items-center justify-center'>
              <Empty
                description={t('customerService.workbench.emptyUnified', { defaultValue: '暂无进行中的会话' })}
              />
            </div>
          ) : (
            <>
              <div className='flex shrink-0 items-center justify-between gap-12px px-16px py-10px border-b border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)]'>
                <div className='flex flex-col min-w-0'>
                  <div className='flex items-center gap-8px'>
                    <span className='text-14px font-500 text-t-primary truncate'>
                      {visitorName(activeItem)}
                    </span>
                    <ChannelBadge type={activeItem.channel_type} />
                    <StateTag state={activeItem.state} />
                  </div>
                  <span className='text-11px text-t-tertiary truncate'>
                    {t('customerService.workbench.sessionId', { defaultValue: '会话编号' })}: {activeItem.cs_dialogue_id}
                    {activeItem.agent_name && ` · ${activeItem.agent_name}`}
                  </span>
                </div>
                <span className='shrink-0 flex items-center gap-6px'>
                  {activeItem.state === 'ai' && (
                    <Button
                      size='mini'
                      type='primary'
                      onClick={() => void takeOver()}
                      disabled={!operatorId}
                    >
                      {t('customerService.workbench.actions.takeover', { defaultValue: '人工接管' })}
                    </Button>
                  )}
                  {activeItem.state === 'human' && (
                    <>
                      <Button size='mini' onClick={() => void release()}>
                        {t('customerService.workbench.actions.release', { defaultValue: '转回 AI' })}
                      </Button>
                      <Button size='mini' type='primary' onClick={openCreateTicket}>
                        <span className='inline-flex items-center gap-4px'>
                          <Plus theme='outline' size='12' fill='currentColor' />
                          {t('customerService.workbench.actions.createTicket', { defaultValue: '建工单' })}
                        </span>
                      </Button>
                    </>
                  )}
                  {activeItem.state !== 'closed' && (
                    <>
                      <Button size='mini' onClick={() => Message.info(t('customerService.workbench.transferHint', { defaultValue: '转接功能后续支持' }))}>
                        {t('customerService.workbench.actions.transfer', { defaultValue: '转接' })}
                      </Button>
                      <Button size='mini' status='danger' onClick={close}>
                        {t('customerService.workbench.actions.close', { defaultValue: '结束' })}
                      </Button>
                    </>
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
              <div className='shrink-0 border-t border-solid border-[var(--color-border-2)] px-16px py-10px bg-[var(--color-bg-2)]'>
                <TextArea
                  value={draft}
                  onChange={setDraft}
                  placeholder={t('customerService.workbench.messages.humanPlaceholder', {
                    defaultValue: '以坐席身份向访客发送…',
                  })}
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  disabled={activeItem.state !== 'human' || sending}
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
                <div className='mt-8px flex items-center justify-between gap-8px'>
                  <span className='inline-flex items-center gap-4px flex-wrap'>
                    {[
                      { key: 'emoji', label: t('customerService.workbench.tools.emoji', { defaultValue: '表情' }) },
                      { key: 'image', label: t('customerService.workbench.tools.image', { defaultValue: '图片' }) },
                      { key: 'file', label: t('customerService.workbench.tools.file', { defaultValue: '文件' }) },
                      { key: 'voice', label: t('customerService.workbench.tools.voice', { defaultValue: '录音' }) },
                      { key: 'video', label: t('customerService.workbench.tools.video', { defaultValue: '视频' }) },
                      { key: 'auto', label: t('customerService.workbench.tools.autoReply', { defaultValue: '自动回复' }) },
                      { key: 'rate', label: t('customerService.workbench.tools.rate', { defaultValue: '邀请评价' }) },
                    ].map((tool) => (
                      <Button
                        key={tool.key}
                        size='mini'
                        type='text'
                        disabled={activeItem.state === 'closed'}
                        onClick={() => Message.info(t('customerService.workbench.tools.comingSoon', { defaultValue: '{{tool}} 功能后续支持', tool: tool.label }))}
                      >
                        {tool.label}
                      </Button>
                    ))}
                  </span>
                  <Button
                    size='small'
                    type='primary'
                    loading={sending}
                    disabled={activeItem.state !== 'human'}
                    onClick={() => void sendHuman()}
                  >
                    <span className='inline-flex items-center gap-4px'>
                      <Send theme='outline' size='14' fill='currentColor' />
                      {t('customerService.workbench.actions.sendHuman', { defaultValue: '发送' })}
                    </span>
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right: Bytedesk-style assistant tabs (visitor / scripts / kb / tickets) */}
        <div className='flex shrink-0 w-320px flex-col border-l border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)]'>
          <Tabs defaultActiveTab='scripts' className='cs-workbench-tabs'>
            <Tabs.TabPane
              key='visitor'
              title={t('customerService.workbench.tabs.visitor', { defaultValue: '访客信息' })}
            >
              <div className='px-12px py-10px flex flex-col gap-10px'>
                {!activeItem ? (
                  <Empty description={t('customerService.workbench.empty', { defaultValue: '未选择会话' })} />
                ) : (
                  <>
                    <div className='flex items-center gap-10px'>
                      <span className='flex items-center justify-center w-40px h-40px rd-full bg-primary-1 text-primary-6 text-15px font-600'>
                        {(visitorName(activeItem) || '?').slice(0, 1).toUpperCase()}
                      </span>
                      <div className='flex flex-col min-w-0'>
                        <span className='text-14px font-500 text-t-primary truncate'>
                          {visitorName(activeItem)}
                        </span>
                        <span className='text-11px text-t-tertiary'>
                          {activeItem.chat_id}
                        </span>
                      </div>
                    </div>
                    <div className='flex flex-col gap-6px text-12px text-t-secondary'>
                      <div className='flex justify-between'>
                        <span>{t('customerService.workbench.fields.state', { defaultValue: '状态' })}</span>
                        <StateTag state={activeItem.state} />
                      </div>
                      <div className='flex justify-between'>
                        <span>{t('customerService.workbench.fields.agent', { defaultValue: '接待客服' })}</span>
                        <span className='text-t-primary'>{activeItem.agent_name || activeItem.cs_agent_id}</span>
                      </div>
                      <div className='flex justify-between'>
                        <span>{t('customerService.workbench.fields.channel', { defaultValue: '渠道' })}</span>
                        <span className='text-t-primary'>{activeItem.channel_name || activeItem.channel_plugin_id}</span>
                      </div>
                      <div className='flex justify-between'>
                        <span>{t('customerService.workbench.fields.created', { defaultValue: '创建时间' })}</span>
                        <span className='text-t-primary'>{new Date(activeItem.created_at).toLocaleString()}</span>
                      </div>
                      {activeItem.taken_by && (
                        <div className='flex justify-between'>
                          <span>{t('customerService.workbench.fields.operator', { defaultValue: '当前坐席' })}</span>
                          <span className='text-t-primary'>{activeItem.taken_by}</span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </Tabs.TabPane>
            <Tabs.TabPane
              key='scripts'
              title={t('customerService.workbench.tabs.scripts', { defaultValue: '快捷回复' })}
            >
              <div className='grow min-h-0 overflow-y-auto px-12px py-8px'>
                {scripts.length === 0 ? (
                  <div className='text-12px text-t-tertiary py-8px'>
                    {t('customerService.workbench.scripts.empty', {
                      defaultValue: '还没有快捷话术',
                    })}
                  </div>
                ) : (
                  <div className='flex flex-col gap-8px'>
                    {scripts.map((note) => (
                      <div
                        key={note.cs_note_id}
                        className='flex items-start gap-6px rd-8px border border-solid border-[var(--color-border-2)] px-10px py-8px hover:bg-fill-1'
                      >
                        <span className='grow text-12px text-t-primary whitespace-pre-wrap break-words'>
                          {note.content}
                        </span>
                        <Button
                          size='mini'
                          type='text'
                          onClick={() => void sendScript(note)}
                          disabled={!activeItem || activeItem.state === 'closed'}
                        >
                          <Send theme='outline' size='12' fill='currentColor' />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Tabs.TabPane>
            <Tabs.TabPane
              key='kb'
              title={t('customerService.workbench.tabs.kb', { defaultValue: '知识库' })}
            >
              <div className='px-12px py-10px text-12px text-t-secondary'>
                {t('customerService.workbench.kb.hint', {
                  defaultValue: '当前客服绑定的知识库已在推理时自动检索，后续此处可查看命中片段。',
                })}
              </div>
            </Tabs.TabPane>
            <Tabs.TabPane
              key='tickets'
              title={
                <span className='inline-flex items-center gap-4px'>
                  {t('customerService.workbench.tabs.tickets', { defaultValue: '工单' })}
                  <span className='text-11px text-t-tertiary'>({tickets.length})</span>
                </span>
              }
            >
              <div className='grow min-h-0 overflow-y-auto px-12px py-8px'>
                {ticketsLoading ? (
                  <div className='flex h-full items-center justify-center'>
                    <Spin />
                  </div>
                ) : tickets.length === 0 ? (
                  <div className='text-12px text-t-tertiary py-8px'>
                    {t('customerService.workbench.tickets.empty', { defaultValue: '暂无相关工单' })}
                  </div>
                ) : (
                  <div className='flex flex-col gap-8px'>
                    {tickets.map((ticket) => (
                      <div
                        key={ticket.cs_ticket_id}
                        className='rd-8px border border-solid border-[var(--color-border-2)] px-10px py-8px'
                      >
                        <div className='flex items-center justify-between gap-4px'>
                          <span className='truncate text-13px font-500'>{ticket.title}</span>
                          <Tag
                            size='small'
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
                    ))}
                  </div>
                )}
              </div>
            </Tabs.TabPane>
          </Tabs>
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
