/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Checkbox,
  Input,
  InputNumber,
  Message,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Switch,
  Table,
  Tag,
} from '@arco-design/web-react';
import { Delete, Headset, Left, Plus } from '@icon-park/react';
import { ipcBridge } from '@/common';
import type { IBusinessEndpoint, ICsNote } from '@/common/adapter/ipcBridge';
import { parseCsAgentId, type CsAgentId, type KnowledgeBaseId, type ProviderId } from '@/common/types/ids';
import { useModelsForTask } from '@renderer/hooks/agent/useModelsForTask';
import CsChannelBotsSection from './CsChannelBotsSection';
import { useCsAgent } from './useCsAgents';
import { useKnowledgeBaseOptions } from './useKnowledgeBaseOptions';

/** One titled card section on the detail page. */
const Section: React.FC<{ title: string; extra?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  extra,
  children,
}) => (
  <div className='flex flex-col gap-12px rd-16px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] px-16px py-14px'>
    <div className='flex items-center justify-between gap-12px'>
      <span className='text-14px font-600 text-t-primary'>{title}</span>
      {extra}
    </div>
    {children}
  </div>
);

/** 业务端点 URL 校验（与管理端后端 SSRF 防护对齐）：仅 https，host 不可为
 * localhost 或内网地址。返回错误信息；null 表示通过。 */
function validateEndpointUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return 'URL 不能为空';
  if (!/^https:\/\//i.test(trimmed)) return '仅允许 https:// 开头（安全策略）';
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost')) return '禁止指向 localhost';
    if (host === '0.0.0.0' || host === '[::1]' || host === '::1') return '禁止指向本地地址';
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const o = ipv4.slice(1).map(Number);
      const priv =
        o[0] === 10 ||
        o[0] === 127 ||
        o[0] === 0 ||
        (o[0] === 169 && o[1] === 254) ||
        (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
        (o[0] === 192 && o[1] === 168);
      if (priv) return '禁止指向内网 IP';
    }
    return null;
  } catch {
    return 'URL 格式无效';
  }
}

/**
 * 客服详情页（/customer-service/:cs_agent_id）：身份与话术编辑、模型与知识库、
 * 渠道机器人绑定管理（复选全量替换）、客服笔记（cs_notes）简表 CRUD。
 */
const CsAgentDetailPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ cs_agent_id: string }>();
  const csAgentId = useMemo<CsAgentId | null>(() => {
    try {
      return params.cs_agent_id ? parseCsAgentId(params.cs_agent_id) : null;
    } catch {
      return null;
    }
  }, [params.cs_agent_id]);

  const { agent, loading, patch, reload } = useCsAgent(csAgentId);
  // Task-filtered catalog (chat): providers with at least one chat-capable model.
  const { groups: chatGroups } = useModelsForTask('chat');
  const providers = useMemo(() => (chatGroups ?? []).map((g) => g.provider), [chatGroups]);
  const { options: kbOptions } = useKnowledgeBaseOptions();

  // ── identity draft (explicit save; text fields shouldn't PATCH per keystroke) ──
  const [draft, setDraft] = useState({ name: '', greeting: '', persona: '', service_policy: '' });
  const [savingIdentity, setSavingIdentity] = useState(false);
  useEffect(() => {
    if (agent) {
      setDraft({
        name: agent.name,
        greeting: agent.greeting,
        persona: agent.persona,
        service_policy: agent.service_policy,
      });
    }
  }, [agent]);

  const saveIdentity = async () => {
    setSavingIdentity(true);
    try {
      await patch({
        name: draft.name.trim(),
        greeting: draft.greeting,
        persona: draft.persona,
        service_policy: draft.service_policy,
      });
      Message.success(t('customerService.detail.saved', { defaultValue: '已保存' }));
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingIdentity(false);
    }
  };

  // ── notes ────────────────────────────────────────────────────────────
  const [notes, setNotes] = useState<ICsNote[]>([]);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState({ kind: 'faq', content: '', shared: false });
  const [savingNote, setSavingNote] = useState(false);

  const refreshNotes = useCallback(async () => {
    if (!csAgentId) return;
    try {
      setNotes((await ipcBridge.customerService.listNotes.invoke({ cs_agent_id: csAgentId })) ?? []);
    } catch {
      setNotes([]);
    }
  }, [csAgentId]);

  useEffect(() => {
    void refreshNotes();
  }, [refreshNotes]);

  const createNote = async () => {
    if (!csAgentId || !noteDraft.content.trim()) return;
    setSavingNote(true);
    try {
      await ipcBridge.customerService.createNote.invoke({
        cs_agent_id: noteDraft.shared ? null : csAgentId,
        kind: noteDraft.kind,
        content: noteDraft.content,
        enabled: true,
      });
      setNoteModalOpen(false);
      setNoteDraft({ kind: 'faq', content: '', shared: false });
      await refreshNotes();
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingNote(false);
    }
  };

  // ── business query endpoints (read-only capability) ─────────────────
  const [endpoints, setEndpoints] = useState<IBusinessEndpoint[]>([]);
  const [endpointModalOpen, setEndpointModalOpen] = useState(false);
  const [endpointDraft, setEndpointDraft] = useState({ name: '', url_template: '', description: '' });
  const [savingEndpoint, setSavingEndpoint] = useState(false);
  useEffect(() => {
    if (agent) setEndpoints(agent.business_endpoints ?? []);
  }, [agent]);

  const endpointUrlError = validateEndpointUrl(endpointDraft.url_template);

  const saveEndpoints = async (next: IBusinessEndpoint[]) => {
    if (!csAgentId) return;
    setEndpoints(next);
    try {
      await patch({ business_endpoints: next });
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const addEndpoint = async () => {
    const name = endpointDraft.name.trim();
    const url = endpointDraft.url_template.trim();
    const description = endpointDraft.description.trim();
    if (!name) {
      Message.warning(t('customerService.endpoints.nameRequired', { defaultValue: '请填写端点名称' }));
      return;
    }
    const urlError = validateEndpointUrl(url);
    if (urlError) {
      Message.warning(urlError);
      return;
    }
    setSavingEndpoint(true);
    try {
      await saveEndpoints([...endpoints, { name, url_template: url, description }]);
      setEndpointModalOpen(false);
      setEndpointDraft({ name: '', url_template: '', description: '' });
      Message.success(t('customerService.endpoints.added', { defaultValue: '已添加业务查询端点' }));
    } finally {
      setSavingEndpoint(false);
    }
  };

  const removeEndpoint = (index: number) => {
    void saveEndpoints(endpoints.filter((_, i) => i !== index));
  };

  // ── delete agent ─────────────────────────────────────────────────────
  const deleteAgent = async () => {
    if (!csAgentId) return;
    try {
      await ipcBridge.customerService.removeAgent.invoke({ cs_agent_id: csAgentId });
      Message.success(t('customerService.detail.deleted', { defaultValue: '客服已删除' }));
      void navigate('/customer-service');
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    }
  };

  if (loading) {
    return (
      <div className='flex justify-center py-56px'>
        <Spin />
      </div>
    );
  }
  if (!agent) {
    return (
      <div className='flex flex-col items-center gap-12px py-56px text-t-tertiary'>
        {t('customerService.detail.notFound', { defaultValue: '客服不存在或已删除' })}
        <Button onClick={() => void navigate('/customer-service')}>
          {t('customerService.detail.back', { defaultValue: '返回花名册' })}
        </Button>
      </div>
    );
  }

  const provider = providers.find((p) => p.id === agent.provider_id);
  const modelOptions = chatGroups.find((g) => g.provider.id === agent.provider_id)?.models ?? [];
  const knowledgeBaseIds = Array.isArray(agent.knowledge_base_ids) ? agent.knowledge_base_ids : [];

  return (
    <div className='w-full min-h-full box-border overflow-y-auto px-16px py-20px'>
      <div className='mx-auto flex w-full max-w-[920px] box-border flex-col gap-16px'>
        {/* Header */}
        <div className='flex items-center gap-12px flex-wrap'>
          <Button size='small' onClick={() => void navigate('/customer-service')}>
            <span className='inline-flex items-center gap-4px'>
              <Left theme='outline' size='14' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
              {t('customerService.detail.back', { defaultValue: '返回花名册' })}
            </span>
          </Button>
          <span
            className='flex items-center justify-center w-34px h-34px rd-10px shrink-0 text-primary-6'
            style={{
              background: 'linear-gradient(150deg, rgba(var(--primary-5),0.16) 0%, rgba(var(--primary-6),0.26) 100%)',
              border: '1px solid rgba(var(--primary-6),0.22)',
            }}
          >
            <Headset theme='outline' size='18' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
          </span>
          <h1 className='m-0 text-18px font-700 text-t-primary truncate'>{agent.name}</h1>
          <div className='ml-auto flex items-center gap-10px'>
            <span className='text-12px text-t-tertiary'>
              {t('customerService.detail.enabled', { defaultValue: '启用' })}
            </span>
            <Switch
              checked={agent.enabled}
              onChange={(checked: boolean) => void patch({ enabled: checked })}
            />
            <Popconfirm
              title={t('customerService.detail.deleteConfirm', {
                defaultValue: '删除该客服？其绑定、对话记录与私有笔记将一并删除。',
              })}
              onOk={() => void deleteAgent()}
            >
              <Button status='danger' size='small'>
                {t('customerService.detail.delete', { defaultValue: '删除' })}
              </Button>
            </Popconfirm>
          </div>
        </div>

        {/* 身份与话术 */}
        <Section
          title={t('customerService.sections.identity', { defaultValue: '身份与话术' })}
          extra={
            <Button type='primary' size='small' loading={savingIdentity} onClick={() => void saveIdentity()}>
              {t('customerService.detail.save', { defaultValue: '保存' })}
            </Button>
          }
        >
          <div className='flex flex-col gap-10px'>
            <div>
              <div className='mb-4px text-12px text-t-tertiary'>{t('customerService.fields.name', { defaultValue: '名称' })}</div>
              <Input value={draft.name} onChange={(value) => setDraft((d) => ({ ...d, name: value }))} />
            </div>
            <div>
              <div className='mb-4px text-12px text-t-tertiary'>{t('customerService.fields.greeting', { defaultValue: '问候语' })}</div>
              <Input.TextArea rows={2} value={draft.greeting} onChange={(value) => setDraft((d) => ({ ...d, greeting: value }))} />
            </div>
            <div>
              <div className='mb-4px text-12px text-t-tertiary'>{t('customerService.fields.persona', { defaultValue: '人设话术' })}</div>
              <Input.TextArea rows={2} value={draft.persona} onChange={(value) => setDraft((d) => ({ ...d, persona: value }))} />
            </div>
            <div>
              <div className='mb-4px text-12px text-t-tertiary'>{t('customerService.fields.servicePolicy', { defaultValue: '服务策略' })}</div>
              <Input.TextArea rows={3} value={draft.service_policy} onChange={(value) => setDraft((d) => ({ ...d, service_policy: value }))} />
            </div>
          </div>
        </Section>

        {/* 模型与知识库 */}
        <Section title={t('customerService.sections.modelKnowledge', { defaultValue: '模型与知识库' })}>
          <div className='grid grid-cols-2 gap-12px'>
            <div>
              <div className='mb-4px text-12px text-t-tertiary'>{t('customerService.fields.provider', { defaultValue: '模型服务商' })}</div>
              <Select
                value={agent.provider_id ?? undefined}
                placeholder={t('customerService.fields.providerPlaceholder', { defaultValue: '选择服务商' })}
                allowClear
                onChange={(value) => void patch({ provider_id: (value as ProviderId | undefined) ?? null, model: null })}
              >
                {providers.map((p) => (
                  <Select.Option key={p.id} value={p.id}>
                    {p.name}
                  </Select.Option>
                ))}
              </Select>
            </div>
            <div>
              <div className='mb-4px text-12px text-t-tertiary'>{t('customerService.fields.model', { defaultValue: '对话模型' })}</div>
              <Select
                value={agent.model ?? undefined}
                placeholder={t('customerService.fields.modelPlaceholder', { defaultValue: '选择模型' })}
                allowClear
                onChange={(value) => void patch({ model: (value as string | undefined) ?? null })}
              >
                {modelOptions.map((m) => (
                  <Select.Option key={m} value={m}>
                    {m}
                  </Select.Option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <div className='mb-4px text-12px text-t-tertiary'>{t('customerService.fields.knowledgeBases', { defaultValue: '知识库' })}</div>
            <Select
              mode='multiple'
              value={knowledgeBaseIds}
              placeholder={t('customerService.fields.knowledgeBasesPlaceholder', { defaultValue: '选择可检索的知识库' })}
              allowClear
              onChange={(value) => {
                const next = Array.isArray(value) ? value : value == null ? [] : [value];
                void patch({ knowledge_base_ids: next as KnowledgeBaseId[] });
              }}
            >
              {kbOptions.map((kb) => (
                <Select.Option key={kb.value} value={kb.value}>
                  {kb.label}
                </Select.Option>
              ))}
            </Select>
          </div>
          <div className='flex items-center gap-10px'>
            <span className='text-12px text-t-tertiary'>{t('customerService.fields.maxConcurrent', { defaultValue: '并发上限' })}</span>
            <InputNumber
              min={1}
              max={64}
              value={agent.max_concurrent}
              onChange={(value) => {
                if (typeof value === 'number') void patch({ max_concurrent: value });
              }}
            />
          </div>
        </Section>

        {/* 业务查询能力 — 只读 HTTPS GET 端点，让客服能答实时业务问题 */}
        <Section
          title={t('customerService.sections.businessEndpoints', { defaultValue: '业务查询能力' })}
          extra={
            <Button size='small' onClick={() => setEndpointModalOpen(true)}>
              <span className='inline-flex items-center gap-4px'>
                <Plus theme='outline' size='13' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
                {t('customerService.endpoints.add', { defaultValue: '新增端点' })}
              </span>
            </Button>
          }
        >
          <div className='text-12px text-t-tertiary leading-6'>
            {t('customerService.endpoints.hint', {
              defaultValue:
                '为客服接入只读业务查询：每个端点通过 HTTPS GET 调用你授权的业务接口（订单/物流/库存等），模型仅可填充 {参数}，无法访问内网或发起任何写操作。',
            })}
          </div>
          {endpoints.length === 0 ? (
            <div className='text-13px text-t-tertiary py-8px'>
              {t('customerService.endpoints.empty', { defaultValue: '暂无业务查询端点 — 点击右上角"新增端点"接入第一个只读接口。' })}
            </div>
          ) : (
            <div className='flex flex-col gap-8px'>
              {endpoints.map((ep, index) => (
                <div
                  key={`${ep.name}-${index}`}
                  className='flex items-start gap-10px rounded border border-solid border-[var(--color-border-2)] px-12px py-8px'
                >
                  <div className='flex-1 min-w-0'>
                    <div className='text-13px font-600 text-t-primary'>{ep.name}</div>
                    <div className='text-12px text-t-tertiary break-all'>{ep.url_template}</div>
                    {ep.description && <div className='text-12px text-t-secondary mt-2px'>{ep.description}</div>}
                  </div>
                  <Popconfirm
                    title={t('customerService.endpoints.deleteConfirm', { defaultValue: '移除该业务查询端点？' })}
                    onOk={() => removeEndpoint(index)}
                  >
                    <Button size='mini' status='danger' type='text'>
                      <Delete theme='outline' size='14' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
                    </Button>
                  </Popconfirm>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 绑定管理 — 客服域渠道机器人自闭环（与桌面伙伴渠道分域互斥） */}
        {csAgentId && (
          <Section title={t('customerService.sections.bindings', { defaultValue: '渠道机器人绑定' })}>
            <CsChannelBotsSection csAgentId={csAgentId} />
          </Section>
        )}

        {/* 客服笔记 */}
        <Section
          title={t('customerService.sections.notes', { defaultValue: '客服笔记' })}
          extra={
            <Button size='small' onClick={() => setNoteModalOpen(true)}>
              <span className='inline-flex items-center gap-4px'>
                <Plus theme='outline' size='13' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
                {t('customerService.notes.add', { defaultValue: '新增笔记' })}
              </span>
            </Button>
          }
        >
          <Table
            rowKey='cs_note_id'
            data={notes}
            pagination={false}
            size='small'
            noDataElement={
              <span className='text-13px text-t-tertiary'>
                {t('customerService.notes.empty', { defaultValue: '还没有笔记 — FAQ/话术/业务事实都可以放在这里，客服只读引用。' })}
              </span>
            }
            columns={[
              {
                title: t('customerService.notes.kind', { defaultValue: '类型' }),
                dataIndex: 'kind',
                width: 90,
              },
              {
                title: t('customerService.notes.content', { defaultValue: '内容' }),
                dataIndex: 'content',
                render: (content: string) => <span className='whitespace-pre-wrap'>{content}</span>,
              },
              {
                title: t('customerService.notes.scope', { defaultValue: '范围' }),
                width: 90,
                render: (_: unknown, note: ICsNote) => (
                  <Tag size='small' color={note.cs_agent_id ? 'blue' : 'purple'}>
                    {note.cs_agent_id
                      ? t('customerService.notes.private', { defaultValue: '私有' })
                      : t('customerService.notes.shared', { defaultValue: '共享' })}
                  </Tag>
                ),
              },
              {
                title: t('customerService.notes.enabled', { defaultValue: '启用' }),
                width: 80,
                render: (_: unknown, note: ICsNote) => (
                  <Switch
                    size='small'
                    checked={note.enabled}
                    onChange={(checked: boolean) => {
                      void ipcBridge.customerService.patchNote
                        .invoke({ cs_note_id: note.cs_note_id, enabled: checked })
                        .then(() => refreshNotes())
                        .catch((error) => Message.error(String(error)));
                    }}
                  />
                ),
              },
              {
                title: '',
                width: 50,
                render: (_: unknown, note: ICsNote) => (
                  <Popconfirm
                    title={t('customerService.notes.deleteConfirm', { defaultValue: '删除该笔记？' })}
                    onOk={() => {
                      void ipcBridge.customerService.removeNote
                        .invoke({ cs_note_id: note.cs_note_id })
                        .then(() => refreshNotes())
                        .catch((error) => Message.error(String(error)));
                    }}
                  >
                    <Button size='mini' status='danger' type='text'>
                      <Delete theme='outline' size='14' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
                    </Button>
                  </Popconfirm>
                ),
              },
            ]}
          />
        </Section>
      </div>

      {/* 新增笔记 */}
      <Modal
        visible={noteModalOpen}
        title={t('customerService.notes.add', { defaultValue: '新增笔记' })}
        onCancel={() => setNoteModalOpen(false)}
        onOk={() => void createNote()}
        confirmLoading={savingNote}
        okButtonProps={{ disabled: !noteDraft.content.trim() }}
        style={{ width: 460 }}
      >
        <div className='flex flex-col gap-10px'>
          <Select
            value={noteDraft.kind}
            onChange={(value) => setNoteDraft((d) => ({ ...d, kind: value as string }))}
          >
            <Select.Option value='faq'>{t('customerService.notes.kindFaq', { defaultValue: 'FAQ' })}</Select.Option>
            <Select.Option value='script'>{t('customerService.notes.kindScript', { defaultValue: '话术' })}</Select.Option>
            <Select.Option value='fact'>{t('customerService.notes.kindFact', { defaultValue: '业务事实' })}</Select.Option>
          </Select>
          <Input.TextArea
            rows={4}
            value={noteDraft.content}
            placeholder={t('customerService.notes.contentPlaceholder', { defaultValue: '写下 FAQ / 话术 / 业务事实…' })}
            onChange={(value) => setNoteDraft((d) => ({ ...d, content: value }))}
          />
          <label className='flex items-center gap-8px text-13px text-t-secondary'>
            <Checkbox
              checked={noteDraft.shared}
              onChange={(checked: boolean) => setNoteDraft((d) => ({ ...d, shared: checked }))}
            />
            {t('customerService.notes.sharedHint', { defaultValue: '共享给全部客服（不勾选则仅本客服可用）' })}
          </label>
        </div>
      </Modal>

      {/* 新增业务查询端点 */}
      <Modal
        visible={endpointModalOpen}
        title={t('customerService.endpoints.add', { defaultValue: '新增业务查询端点' })}
        onCancel={() => setEndpointModalOpen(false)}
        onOk={() => void addEndpoint()}
        confirmLoading={savingEndpoint}
        okButtonProps={{ disabled: !endpointDraft.name.trim() || !!endpointUrlError }}
        style={{ width: 480 }}
      >
        <div className='flex flex-col gap-10px'>
          <div>
            <div className='mb-4px text-12px text-t-tertiary'>{t('customerService.endpoints.name', { defaultValue: '端点名称' })}</div>
            <Input
              value={endpointDraft.name}
              placeholder={t('customerService.endpoints.namePlaceholder', { defaultValue: '例如：订单查询' })}
              onChange={(value) => setEndpointDraft((d) => ({ ...d, name: value }))}
            />
          </div>
          <div>
            <div className='mb-4px text-12px text-t-tertiary'>{t('customerService.endpoints.url', { defaultValue: '接口 URL 模板（仅 https）' })}</div>
            <Input
              value={endpointDraft.url_template}
              status={endpointUrlError ? 'error' : undefined}
              placeholder='https://api.example.com/orders/{order_id}'
              onChange={(value) => setEndpointDraft((d) => ({ ...d, url_template: value }))}
            />
            {endpointUrlError ? (
              <div className='mt-4px text-12px text-[rgb(var(--red-6))]'>{endpointUrlError}</div>
            ) : (
              <div className='mt-4px text-12px text-t-tertiary'>
                {t('customerService.endpoints.urlHint', {
                  defaultValue: '用 {参数名} 占位，对话时由模型填充（仅支持字母数字及 _ . - @ +）。',
                })}
              </div>
            )}
          </div>
          <div>
            <div className='mb-4px text-12px text-t-tertiary'>{t('customerService.endpoints.description', { defaultValue: '说明（展示给模型）' })}</div>
            <Input.TextArea
              rows={2}
              value={endpointDraft.description}
              placeholder={t('customerService.endpoints.descriptionPlaceholder', { defaultValue: '这个接口返回什么，例如：根据订单号返回订单状态与物流信息。' })}
              onChange={(value) => setEndpointDraft((d) => ({ ...d, description: value }))}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default CsAgentDetailPage;
