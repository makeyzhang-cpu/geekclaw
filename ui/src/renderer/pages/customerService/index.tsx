/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Spin, Tag } from '@arco-design/web-react';
import { Api, BookOne, Headset, Left, Lock, Plus, SafeRetrieval, Send } from '@icon-park/react';
import { useCsAgents } from './useCsAgents';
import CreateCsAgentModal from './CreateCsAgentModal';
import type { ICsAgent } from '@/common/adapter/ipcBridge';
import type { CsAgentId } from '@/common/types/ids';
import { HUB_PAGE_TITLE_CLASS } from '@/renderer/components/layout/HubPageShell';

/** 客服花名册卡片：名称 + 启停状态 + 模型/知识库指标 + 管理/工作台/测试入口。点击进入专属管理页。 */
const CsAgentCard: React.FC<{ agent: ICsAgent; onOpen: () => void; onWorkbench: () => void; onChat: () => void }> = ({
  agent,
  onOpen,
  onWorkbench,
  onChat,
}) => {
  const { t } = useTranslation();
  const modelReady = Boolean(agent.provider_id && agent.model);
  return (
    <div
      onClick={onOpen}
      role='button'
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className='group flex flex-col gap-10px rd-16px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] px-16px py-14px cursor-pointer outline-none transition-all hover:border-[rgba(var(--primary-6),0.5)] hover:shadow-[0_12px_30px_rgba(var(--primary-6),0.12)] hover:-translate-y-2px focus-visible:border-primary-6'
    >
      <div className='flex items-center gap-10px'>
        <span
          className='flex items-center justify-center w-38px h-38px rd-10px shrink-0 text-primary-6'
          style={{
            background: 'linear-gradient(150deg, rgba(var(--primary-5),0.16) 0%, rgba(var(--primary-6),0.26) 100%)',
            border: '1px solid rgba(var(--primary-6),0.22)',
          }}
        >
          <Headset theme='outline' size='20' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
        </span>
        <span className='text-15px font-700 text-t-primary truncate'>{agent.name}</span>
        <Tag className='ml-auto shrink-0' color={agent.enabled ? 'green' : 'gray'} size='small'>
          {agent.enabled
            ? t('customerService.status.enabled', { defaultValue: '服务中' })
            : t('customerService.status.disabled', { defaultValue: '已停用' })}
        </Tag>
      </div>
      <div className='flex items-center gap-14px text-12px text-t-tertiary'>
        <span className='inline-flex items-center gap-5px min-w-0'>
          <SafeRetrieval theme='outline' size='14' fill='currentColor' className='block shrink-0' style={{ lineHeight: 0 }} />
          <span className='truncate'>
            {modelReady
              ? agent.model
              : t('customerService.card.noModel', { defaultValue: '未配置模型' })}
          </span>
        </span>
        <span className='inline-flex items-center gap-5px shrink-0'>
          <BookOne theme='outline' size='14' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
          {t('customerService.card.kbCount', {
            defaultValue: '{{count}} 个知识库',
            count: agent.knowledge_base_ids.length,
          })}
        </span>
        <span className='ml-auto inline-flex items-center gap-6px shrink-0'>
          <Button
            size='mini'
            type='primary'
            onClick={(e) => {
              e.stopPropagation();
              onWorkbench();
            }}
          >
            <span className='inline-flex items-center gap-4px'>
              <Headset theme='outline' size='13' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
              {t('customerService.roster.openWorkbench', { defaultValue: '进入工作台' })}
            </span>
          </Button>
          <Button
            size='mini'
            onClick={(e) => {
              e.stopPropagation();
              onChat();
            }}
          >
            <span className='inline-flex items-center gap-4px'>
              <Send theme='outline' size='13' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
              {t('customerService.chat.openChat', { defaultValue: '测试对话' })}
            </span>
          </Button>
        </span>
      </div>
    </div>
  );
};

/**
 * 客服管理后台（/customer-service/roster）—— 客服花名册与配置入口。
 *
 * 默认首页已改为直进工作台（/customer-service → /customer-service/:id/workbench）。
 * 此处保留为员工管理、模型/知识库配置与渠道机器人绑定页的管理后台。
 */
const CustomerServiceRosterPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agents, loading, create } = useCsAgents();
  const [createOpen, setCreateOpen] = useState(false);

  const openAgent = (csAgentId: CsAgentId) => void navigate(`/customer-service/${csAgentId}`);
  const openWorkbench = (csAgentId: CsAgentId) => void navigate(`/customer-service/${csAgentId}/workbench`);
  const openChat = (csAgentId: CsAgentId) => void navigate(`/customer-service/${csAgentId}/chat`);

  return (
    <div className='w-full min-h-full box-border overflow-y-auto px-16px py-20px'>
      <div className='mx-auto flex w-full max-w-[1160px] box-border flex-col gap-16px'>
        {/* Header */}
        <div className='flex items-start justify-between gap-16px flex-wrap'>
          <div className='min-w-0'>
          <div className='flex items-center gap-10px mb-3px'>
            <Button size='mini' type='text' onClick={() => void navigate('/customer-service')}>
              <span className='inline-flex items-center gap-4px'>
                <Left theme='outline' size='14' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
                {t('customerService.roster.backToWorkbench', { defaultValue: '返回工作台' })}
              </span>
            </Button>
            <h1 className={HUB_PAGE_TITLE_CLASS}>
              {t('customerService.roster.title', { defaultValue: '客服管理' })}
            </h1>
          </div>
            <p className='m-0 text-13px text-t-secondary leading-19px max-w-[560px]'>
              {t('customerService.subtitle', {
                defaultValue:
                  '面向陌生访客的客服员工 —— 只依据知识库、客服笔记与可选的只读业务接口回答，高危能力从不注册。',
              })}
            </p>
          </div>
          <Button type='primary' size='default' className='shrink-0' onClick={() => setCreateOpen(true)}>
            <span className='inline-flex items-center gap-6px'>
              <Plus theme='outline' size='15' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
              {t('customerService.create.action', { defaultValue: '创建客服' })}
            </span>
          </Button>
          <Button
            size='default'
            className='shrink-0'
            onClick={() => void navigate('/customer-service/channels')}
          >
            <span className='inline-flex items-center gap-6px'>
              <Api theme='outline' size='15' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
              {t('customerService.channels.openChannels', { defaultValue: '渠道中心' })}
            </span>
          </Button>
          <Button
            size='default'
            className='shrink-0'
            onClick={() => void navigate('/customer-service/tickets')}
          >
            {t('customerService.tickets.openTickets', { defaultValue: '工单' })}
          </Button>
        </div>

        {/* Trust banner — what this domain guarantees. */}
        <div
          className='flex flex-wrap items-center gap-x-20px gap-y-8px rd-14px px-16px py-12px border border-solid'
          style={{
            background: 'linear-gradient(135deg, rgba(var(--primary-6),0.06) 0%, rgba(var(--primary-6),0.02) 100%)',
            borderColor: 'rgba(var(--primary-6),0.18)',
          }}
        >
          <span className='inline-flex items-center gap-7px text-12px text-t-secondary'>
            <SafeRetrieval theme='outline' size='15' fill='rgb(var(--primary-6))' className='block' style={{ lineHeight: 0 }} />
            {t('customerService.trust.readonly', { defaultValue: '仅三个只读工具：知识检索 / 知识阅读 / 客服笔记' })}
          </span>
          <span className='inline-flex items-center gap-7px text-12px text-t-secondary'>
            <Lock theme='outline' size='15' fill='rgb(var(--primary-6))' className='block' style={{ lineHeight: 0 }} />
            {t('customerService.trust.locked', { defaultValue: '终端 / 文件 / 电脑 / 浏览器 等高危能力从不注册' })}
          </span>
          <span className='inline-flex items-center gap-7px text-12px text-t-secondary'>
            <SafeRetrieval theme='outline' size='15' fill='rgb(var(--primary-6))' className='block' style={{ lineHeight: 0 }} />
            {t('customerService.trust.businessQuery', {
              defaultValue: '可选只读业务查询：仅你授权的 HTTPS 接口，模型无法访问内网或写数据',
            })}
          </span>
        </div>

        {/* Roster */}
        {loading ? (
          <div className='flex justify-center py-56px'>
            <Spin />
          </div>
        ) : agents.length === 0 ? (
          <div className='flex flex-col items-center justify-center gap-14px px-24px py-64px text-center'>
            <span
              className='flex items-center justify-center w-72px h-72px rounded-full text-primary-6'
              style={{
                background: 'var(--color-fill-2)',
              }}
            >
              <Headset theme='outline' size='32' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
            </span>
            <div className='flex flex-col gap-4px'>
              <span className='text-15px font-600 text-t-primary'>
                {t('customerService.empty.title', { defaultValue: '还没有客服' })}
              </span>
              <span className='text-13px text-t-tertiary max-w-[440px]'>
                {t('customerService.empty.desc', {
                  defaultValue: '创建一位客服，绑定知识库与服务策略，再把渠道机器人绑给它，让它安全地接待访客。',
                })}
              </span>
            </div>
            <Button type='primary' onClick={() => setCreateOpen(true)}>
              <span className='inline-flex items-center gap-6px'>
                <Plus theme='outline' size='15' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
                {t('customerService.empty.action', { defaultValue: '创建第一位客服' })}
              </span>
            </Button>
          </div>
        ) : (
          <div className='grid gap-16px' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))' }}>
            {agents.map((agent) => (
              <CsAgentCard
                key={agent.cs_agent_id}
                agent={agent}
                onOpen={() => openAgent(agent.cs_agent_id)}
                onWorkbench={() => openWorkbench(agent.cs_agent_id)}
                onChat={() => openChat(agent.cs_agent_id)}
              />
            ))}
          </div>
        )}
      </div>

      <CreateCsAgentModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(agent) => openAgent(agent.cs_agent_id)}
        create={create}
      />
    </div>
  );
};

export default CustomerServiceRosterPage;
