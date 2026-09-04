// 5.0.22 客服工单管理：跨 agent 的工单列表 + 状态流转 + 编辑。
//
// 形态刻意保持轻量 —— 这是操作员的事后跟进面板，不是 Jira。MVP 范围：
// - 按 agent / status 过滤的工单列表（最新更新优先）
// - 点开右侧抽屉看详情 + 编辑 + 状态流转 + 删除
// - 顶部「新建工单」按 agent 分组创建
//
// 不做：评论 / 附件 / SLA / 自动分配。

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Drawer,
  Empty,
  Input,
  Message,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Tag,
} from '@arco-design/web-react';
import { Left, Plus, Refresh } from '@icon-park/react';

import { ipcBridge } from '@/common';
import type { ICsAgent, ICsTicket } from '@/common/adapter/ipcBridge';
import type { CsAgentId } from '@/common/types/ids';
import { useCsAgents } from './useCsAgents';

const STATUS_KEYS = ['pending', 'in_progress', 'resolved', 'cancelled'] as const;
type TicketStatus = (typeof STATUS_KEYS)[number];

const PRIORITY_KEYS = ['low', 'normal', 'high', 'urgent'] as const;
type TicketPriority = (typeof PRIORITY_KEYS)[number];

const STATUS_COLOR: Record<TicketStatus, string> = {
  pending: 'orange',
  in_progress: 'arcoblue',
  resolved: 'green',
  cancelled: 'gray',
};

const TicketsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agents, loading: agentsLoading } = useCsAgents();

  const [agentFilter, setAgentFilter] = useState<CsAgentId | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'all'>('all');
  const [tickets, setTickets] = useState<ICsTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [openTicket, setOpenTicket] = useState<ICsTicket | null>(null);

  const agentsById = useMemo(() => {
    const map = new Map<string, ICsAgent>();
    for (const agent of agents) map.set(agent.cs_agent_id, agent);
    return map;
  }, [agents]);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const list = await ipcBridge.customerService.listTickets.invoke({
        cs_agent_id:
          agentFilter === 'all' ? undefined : (agentFilter as CsAgentId),
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: 200,
      });
      setTickets(list);
    } catch (err) {
      console.error('tickets: load failed', err);
      Message.error(String(err));
    } finally {
      setLoading(false);
    }
  }, [agentFilter, statusFilter]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  const refresh = useCallback(() => void loadTickets(), [loadTickets]);

  const updateStatus = useCallback(
    async (ticket: ICsTicket, status: TicketStatus) => {
      try {
        await ipcBridge.customerService.updateTicket.invoke({
          cs_ticket_id: ticket.cs_ticket_id,
          status,
        });
        Message.success(
          t('customerService.tickets.actions.saved', { defaultValue: '工单已保存' }),
        );
        await loadTickets();
        if (openTicket?.cs_ticket_id === ticket.cs_ticket_id) {
          const next = await ipcBridge.customerService.getTicket.invoke({
            cs_ticket_id: ticket.cs_ticket_id,
          });
          setOpenTicket(next);
        }
      } catch (err) {
        Message.error(String(err));
      }
    },
    [loadTickets, openTicket, t],
  );

  const deleteTicket = useCallback(
    async (ticket: ICsTicket) => {
      try {
        await ipcBridge.customerService.deleteTicket.invoke({
          cs_ticket_id: ticket.cs_ticket_id,
        });
        Message.success(
          t('customerService.tickets.actions.deleted', { defaultValue: '工单已删除' }),
        );
        if (openTicket?.cs_ticket_id === ticket.cs_ticket_id) setOpenTicket(null);
        await loadTickets();
      } catch (err) {
        Message.error(String(err));
      }
    },
    [loadTickets, openTicket, t],
  );

  const openCreateModal = useCallback(() => {
    Modal.confirm({
      title: t('customerService.tickets.newTicket', { defaultValue: '新建工单' }),
      content: (
        <CreateTicketForm
          agents={agents}
          defaultAgentId={agentFilter === 'all' ? null : agentFilter}
          onSubmit={async (input) => {
            try {
              await ipcBridge.customerService.createTicket.invoke(input);
              Message.success(
                t('customerService.tickets.actions.created', { defaultValue: '工单已创建' }),
              );
              await loadTickets();
              return 'ok';
            } catch (err) {
              Message.error(String(err));
              throw err;
            }
          }}
        />
      ),
      onOk: () => Promise.resolve(),
      okText: t('customerService.tickets.actions.save', { defaultValue: '保存' }),
      cancelText: t('common.cancel', { defaultValue: '取消' }),
    });
  }, [agentFilter, agents, loadTickets, t]);

  return (
    <div className='flex h-full w-full flex-col box-border'>
      <div className='flex shrink-0 items-center gap-12px border-b border-solid border-[var(--color-border-2)] px-16px py-10px'>
        <Button
          size='small'
          type='text'
          onClick={() => void navigate('/customer-service')}
        >
          <span className='inline-flex items-center gap-4px'>
            <Left theme='outline' size='14' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
            {t('customerService.tickets.back', { defaultValue: '返回' })}
          </span>
        </Button>
        <span className='text-15px font-500'>
          {t('customerService.tickets.title', { defaultValue: '工单' })}
        </span>
        <span className='text-12px text-t-tertiary'>
          {t('customerService.tickets.subtitle', {
            defaultValue: '把对话里需要后续跟进的事写下来。',
          })}
        </span>
        <span className='ml-auto flex items-center gap-6px'>
          <Button size='small' onClick={refresh} icon={<Refresh theme='outline' size='14' fill='currentColor' />}>
            {t('common.refresh', { defaultValue: '刷新' })}
          </Button>
          <Button
            size='small'
            type='primary'
            onClick={openCreateModal}
            disabled={agentsLoading || agents.length === 0}
          >
            <span className='inline-flex items-center gap-4px'>
              <Plus theme='outline' size='14' fill='currentColor' />
              {t('customerService.tickets.newTicket', { defaultValue: '新建工单' })}
            </span>
          </Button>
        </span>
      </div>
      <div className='shrink-0 px-16px py-10px flex items-center gap-8px border-b border-solid border-[var(--color-border-2)]'>
        <Select
          value={agentFilter}
          onChange={(value) => setAgentFilter(value as CsAgentId | 'all')}
          style={{ width: '200px' }}
        >
          <Select.Option value='all'>
            {t('customerService.tickets.filter.all', { defaultValue: '全部客服' })}
          </Select.Option>
          {agents.map((agent) => (
            <Select.Option key={agent.cs_agent_id} value={agent.cs_agent_id}>
              {agent.name}
            </Select.Option>
          ))}
        </Select>
        <Select
          value={statusFilter}
          onChange={(value) => setStatusFilter(value as TicketStatus | 'all')}
          style={{ width: '140px' }}
        >
          <Select.Option value='all'>
            {t('customerService.tickets.filter.all', { defaultValue: '全部' })}
          </Select.Option>
          {STATUS_KEYS.map((status) => (
            <Select.Option key={status} value={status}>
              {t(`customerService.tickets.filter.${status === 'in_progress' ? 'inProgress' : status}`, {
                defaultValue: status,
              })}
            </Select.Option>
          ))}
        </Select>
        <span className='ml-auto text-12px text-t-tertiary'>{tickets.length}</span>
      </div>
      <div className='grow min-h-0 overflow-y-auto'>
        {loading ? (
          <div className='flex h-full items-center justify-center'>
            <Spin />
          </div>
        ) : tickets.length === 0 ? (
          <Empty
            description={t('customerService.tickets.empty', { defaultValue: '还没有工单' })}
          />
        ) : (
          tickets.map((ticket) => (
            <div
              key={ticket.cs_ticket_id}
              onClick={() => setOpenTicket(ticket)}
              className='flex cursor-pointer items-center gap-12px border-b border-solid border-[var(--color-border-1)] px-16px py-12px hover:bg-fill-1'
            >
              <div className='flex grow min-w-0 flex-col gap-4px'>
                <div className='flex items-center gap-6px'>
                  <span className='truncate text-14px font-500'>{ticket.title}</span>
                  <Tag color={STATUS_COLOR[ticket.status]}>{ticket.status}</Tag>
                  <Tag>{ticket.priority}</Tag>
                </div>
                {ticket.description && (
                  <p className='line-clamp-2 text-12px text-t-secondary whitespace-pre-wrap break-words'>
                    {ticket.description}
                  </p>
                )}
                <div className='flex items-center gap-8px text-11px text-t-tertiary'>
                  {ticket.cs_agent_id && (
                    <span>
                      {t('customerService.tickets.fields.linkToDialogue', { defaultValue: '客服' })}:{' '}
                      {agentsById.get(ticket.cs_agent_id)?.name ?? ticket.cs_agent_id.slice(0, 8)}
                    </span>
                  )}
                  {ticket.visitor_handle && <span>{ticket.visitor_handle}</span>}
                  {ticket.assignee_id && <span>→ {ticket.assignee_id.slice(0, 8)}…</span>}
                </div>
              </div>
              <span className='shrink-0 text-11px text-t-tertiary'>
                {new Date(ticket.updated_at).toLocaleString()}
              </span>
            </div>
          ))
        )}
      </div>

      <Drawer
        width={420}
        visible={openTicket !== null}
        onCancel={() => setOpenTicket(null)}
        footer={null}
        title={openTicket?.title}
      >
        {openTicket && (
          <TicketDetail
            ticket={openTicket}
            onChangeStatus={(status) => void updateStatus(openTicket, status)}
            onDelete={() => void deleteTicket(openTicket)}
            onClose={() => setOpenTicket(null)}
          />
        )}
      </Drawer>
    </div>
  );
};

const TicketDetail: React.FC<{
  ticket: ICsTicket;
  onChangeStatus: (status: TicketStatus) => void;
  onDelete: () => void;
  onClose: () => void;
}> = ({ ticket, onChangeStatus, onDelete, onClose }) => {
  const { t } = useTranslation();
  return (
    <div className='flex flex-col gap-12px'>
      <div className='flex items-center gap-6px'>
        <Tag color={STATUS_COLOR[ticket.status]}>{ticket.status}</Tag>
        <Tag>{ticket.priority}</Tag>
      </div>
      {ticket.description && (
        <div className='text-13px text-t-primary whitespace-pre-wrap break-words'>
          {ticket.description}
        </div>
      )}
      <div className='flex flex-col gap-4px text-12px text-t-tertiary'>
        <span>
          {t('customerService.tickets.fields.visitorName', { defaultValue: '访客姓名' })}:{' '}
          {ticket.visitor_name || '—'}
        </span>
        <span>
          {t('customerService.tickets.fields.visitorHandle', { defaultValue: '访客联系方式' })}:{' '}
          {ticket.visitor_handle || '—'}
        </span>
        {ticket.assignee_id && (
          <span>
            {t('customerService.tickets.fields.assignee', { defaultValue: '受理人' })}:{' '}
            {ticket.assignee_id}
          </span>
        )}
      </div>
      <div className='flex flex-wrap gap-6px'>
        {STATUS_KEYS.filter((status) => status !== ticket.status).map((status) => (
          <Button
            key={status}
            size='mini'
            onClick={() => onChangeStatus(status)}
          >
            {t(`customerService.tickets.filter.${status === 'in_progress' ? 'inProgress' : status}`, {
              defaultValue: status,
            })}
          </Button>
        ))}
      </div>
      <div className='flex items-center gap-6px'>
        <Popconfirm
          title={t('customerService.tickets.actions.deleteConfirm', { defaultValue: '删除该工单？' })}
          onOk={onDelete}
        >
          <Button size='small' status='danger'>
            {t('customerService.tickets.actions.delete', { defaultValue: '删除' })}
          </Button>
        </Popconfirm>
        <Button size='small' onClick={onClose} className='ml-auto'>
          {t('common.close', { defaultValue: '关闭' })}
        </Button>
      </div>
    </div>
  );
};

const CreateTicketForm: React.FC<{
  agents: ICsAgent[];
  defaultAgentId: CsAgentId | null;
  onSubmit: (input: {
    title: string;
    description?: string;
    priority?: TicketPriority;
    cs_agent_id?: CsAgentId | null;
    visitor_name?: string;
    visitor_handle?: string;
  }) => Promise<string>;
}> = ({ agents, defaultAgentId, onSubmit }) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [agentId, setAgentId] = useState<CsAgentId | ''>(defaultAgentId ?? '');
  const [visitorName, setVisitorName] = useState('');
  const [visitorHandle, setVisitorHandle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submitRef = React.useRef<() => Promise<void>>(async () => undefined);

  React.useEffect(() => {
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
          cs_agent_id: agentId || null,
          visitor_name: visitorName.trim(),
          visitor_handle: visitorHandle.trim(),
        });
      } finally {
        setSubmitting(false);
      }
    };
  }, [title, description, priority, agentId, visitorName, visitorHandle, onSubmit, t]);

  return (
    <div className='flex flex-col gap-8px'>
      <Input
        value={title}
        onChange={setTitle}
        placeholder={t('customerService.tickets.fields.titlePlaceholder', {
          defaultValue: '例如：客户要求退款',
        })}
      />
      <Input.TextArea
        value={description}
        onChange={setDescription}
        autoSize={{ minRows: 2, maxRows: 4 }}
        placeholder={t('customerService.tickets.fields.descriptionPlaceholder', {
          defaultValue: '补充背景、已尝试的步骤、需要的资源…',
        })}
      />
      <div className='flex gap-8px'>
        <Select
          value={priority}
          onChange={(value) => setPriority(value as TicketPriority)}
          style={{ width: '120px' }}
        >
          {PRIORITY_KEYS.map((p) => (
            <Select.Option key={p} value={p}>
              {t(`customerService.tickets.fields.priority${p[0].toUpperCase() + p.slice(1)}`, {
                defaultValue: p,
              })}
            </Select.Option>
          ))}
        </Select>
        <Select
          value={agentId}
          onChange={(value) => setAgentId(value as CsAgentId | '')}
          style={{ width: '160px' }}
          placeholder={t('customerService.tickets.fields.linkToDialogue', {
            defaultValue: '关联会话',
          })}
          allowClear
        >
          {agents.map((agent) => (
            <Select.Option key={agent.cs_agent_id} value={agent.cs_agent_id}>
              {agent.name}
            </Select.Option>
          ))}
        </Select>
      </div>
      <Input
        value={visitorName}
        onChange={setVisitorName}
        placeholder={t('customerService.tickets.fields.visitorName', { defaultValue: '访客姓名' })}
      />
      <Input
        value={visitorHandle}
        onChange={setVisitorHandle}
        placeholder={t('customerService.tickets.fields.visitorHandle', {
          defaultValue: '访客联系方式',
        })}
      />
      <Button type='primary' loading={submitting} onClick={() => void submitRef.current()}>
        {t('customerService.tickets.actions.create', { defaultValue: '创建' })}
      </Button>
    </div>
  );
};

export default TicketsPage;
