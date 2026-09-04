/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// 5.0.23 渠道中心：跨客服的「渠道接入管理」聚合页。
//
// 形态对齐 Bytedesk 渠道接入管理（截图校准）：
// - 左栏 = 渠道平台清单（12 个内置 IM + 扩展渠道），每项显示该平台下客服域
//   bot 的数量与运行状态；选中平台，右侧进入它的接入管理。
// - 右栏 = 该平台下全部客服渠道机器人：状态、绑定客服（下拉指派/改绑）、
//   凭证配置（复用 PlatformConfigBody 全部表单）、删除。
// - 新建：直接对该平台进入 create-mode 配置面，创建成功即出现在列表，
//   由行内「绑定客服」下拉指派给某位客服。
//
// 不做：渠道凭证模板/克隆、群组路由、转接规则 —— 后续版本迭代。

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Empty, Message, Popconfirm, Select, Spin, Tag } from '@arco-design/web-react';
import { Api, Left, Plus, Refresh } from '@icon-park/react';
import { ipcBridge } from '@/common';
import type { IChannelPluginStatus } from '@/common/types/channel/channel';
import type { ChannelPluginId, CsAgentId } from '@/common/types/ids';
import NomiModal from '@/renderer/components/base/NomiModal';
import {
  CHANNEL_PLATFORMS,
  PlatformConfigBody,
} from '@/renderer/components/channels/PlatformConfigBody';
import {
  retargetConfigAfterStatus,
  statusInOwnerDomain,
  type ChannelConfigTarget,
} from '@/renderer/components/channels/channelStatusSelection';
import type { ChannelPlatform } from '@/renderer/components/settings/SettingsModal/contents/channels/channelTarget';
import { HUB_PAGE_TITLE_CLASS } from '@/renderer/components/layout/HubPageShell';
import { useCsAgents } from './useCsAgents';
import { selectCsChannelBots } from './csChannelBots';

/** 平台清单：12 个内置平台排前；扩展渠道按需在列表尾部补位。 */
const BUILTIN_PLATFORM_IDS: ReadonlySet<string> = new Set(CHANNEL_PLATFORMS.map((p) => p.id));

/** 左栏渠道类型行（平台 + 该平台下客服域机器人）。 */
interface PlatformEntry {
  type: string;
  /** 内置平台显示品牌 logo；扩展渠道用通用图标兜底。 */
  meta: (typeof CHANNEL_PLATFORMS)[number] | null;
  bots: IChannelPluginStatus[];
}

const CsChannelsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agents, loading: agentsLoading } = useCsAgents();

  const [statuses, setStatuses] = useState<IChannelPluginStatus[]>([]);
  const [ownerByBot, setOwnerByBot] = useState<ReadonlyMap<ChannelPluginId, CsAgentId>>(new Map());
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [configTarget, setConfigTarget] = useState<ChannelConfigTarget>(null);
  const [rebindingId, setRebindingId] = useState<ChannelPluginId | null>(null);
  const [deletingId, setDeletingId] = useState<ChannelPluginId | null>(null);

  const refreshAll = useCallback(async () => {
    try {
      const [plugins, agentList] = await Promise.all([
        ipcBridge.channel.getPluginStatus.invoke(),
        ipcBridge.customerService.listAgents.invoke(),
      ]);
      const statusList = plugins ?? [];
      setStatuses(statusList);
      // 全量绑定归属（bot → 客服），跨客服聚合。
      const bindingLists = await Promise.all(
        (agentList ?? []).map((agent) =>
          ipcBridge.customerService.listBindings
            .invoke({ cs_agent_id: agent.cs_agent_id })
            .catch(() => [])
        )
      );
      const owners = new Map<ChannelPluginId, CsAgentId>();
      for (const bindings of bindingLists) {
        for (const binding of bindings ?? []) {
          owners.set(binding.channel_plugin_id, binding.cs_agent_id);
        }
      }
      setOwnerByBot(owners);
    } catch (error) {
      console.error('[CsChannels] Failed to load channel status:', error);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
    const unsubscribe = ipcBridge.channel.pluginStatusChanged.on(() => void refreshAll());
    return () => unsubscribe();
  }, [refreshAll]);

  const csBots = useMemo(() => selectCsChannelBots(statuses), [statuses]);

  /** 左栏平台条目：内置平台全量列出（0 机器人也显示为「未接入」），扩展渠道追尾。 */
  const platforms = useMemo<PlatformEntry[]>(() => {
    const extraTypes = [...new Set(csBots.map((bot) => bot.type).filter((type) => !BUILTIN_PLATFORM_IDS.has(type)))];
    return [
      ...CHANNEL_PLATFORMS.map((meta) => ({
        type: meta.id,
        meta,
        bots: csBots.filter((bot) => bot.type === meta.id),
      })),
      ...extraTypes.map((type) => ({
        type,
        meta: null,
        bots: csBots.filter((bot) => bot.type === type),
      })),
    ];
  }, [csBots]);

  // 默认选中第一个有机器人的平台，否则第一个内置平台。
  const activeType = selectedType ?? platforms.find((p) => p.bots.length > 0)?.type ?? CHANNEL_PLATFORMS[0].id;
  const activePlatform = platforms.find((p) => p.type === activeType) ?? null;
  const activeMeta = activePlatform?.meta ?? null;

  const agentById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents) map.set(agent.cs_agent_id, agent.name);
    return map;
  }, [agents]);

  const stats = useMemo(() => {
    const running = csBots.filter((bot) => bot.enabled && bot.connected).length;
    const covered = new Set<CsAgentId>();
    for (const bot of csBots) {
      const owner = ownerByBot.get(bot.plugin_id);
      if (owner) covered.add(owner);
    }
    return { total: csBots.length, running, agents: covered.size };
  }, [csBots, ownerByBot]);

  const platformName = (entry: PlatformEntry): string =>
    entry.meta ? t(entry.meta.titleKey, entry.meta.fallback) : entry.type;

  const botName = (bot: IChannelPluginStatus): string =>
    bot.name || bot.type;

  /** bot 状态徽标（与客服详情页渠道区一致）。 */
  const statusTag = (bot: IChannelPluginStatus) => {
    if (!bot.hasToken) {
      return (
        <Tag size='small' color='gray' className='shrink-0'>
          {t('geekclaw.settings.remoteStatusNotConfigured')}
        </Tag>
      );
    }
    if (bot.enabled && bot.connected) {
      return (
        <Tag size='small' color='green' className='shrink-0'>
          {t('geekclaw.settings.remoteStatusRunning')}
        </Tag>
      );
    }
    if (bot.enabled) {
      return (
        <Tag size='small' bordered={false} className='shrink-0 !bg-primary-1 !text-primary-6'>
          {t('geekclaw.settings.remoteStatusEnabled')}
        </Tag>
      );
    }
    return (
      <Tag size='small' color='gray' className='shrink-0'>
        {t('geekclaw.settings.remoteStatusDisabled')}
      </Tag>
    );
  };

  /** 把单个 bot 指派/改绑/解绑到某客服（replaceBindings 是全量替换语义，先读后合并）。 */
  const rebindBot = async (bot: IChannelPluginStatus, target: CsAgentId | '') => {
    const current = ownerByBot.get(bot.plugin_id) ?? null;
    if (current === target || rebindingId) return;
    setRebindingId(bot.plugin_id);
    try {
      if (current) {
        const cur = (await ipcBridge.customerService.listBindings.invoke({ cs_agent_id: current }))
          .map((binding) => binding.channel_plugin_id)
          .filter((id) => id !== bot.plugin_id);
        await ipcBridge.customerService.replaceBindings.invoke({
          cs_agent_id: current,
          channel_plugin_ids: cur,
        });
      }
      if (target) {
        const next = (await ipcBridge.customerService.listBindings.invoke({ cs_agent_id: target })).map(
          (binding) => binding.channel_plugin_id
        );
        if (!next.includes(bot.plugin_id)) next.push(bot.plugin_id);
        await ipcBridge.customerService.replaceBindings.invoke({
          cs_agent_id: target,
          channel_plugin_ids: next,
        });
      }
      Message.success(t('customerService.channels.rebound', { defaultValue: '绑定已更新' }));
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRebindingId(null);
      await refreshAll();
    }
  };

  const deleteBot = async (bot: IChannelPluginStatus) => {
    setDeletingId(bot.plugin_id);
    try {
      await ipcBridge.channel.deletePlugin.invoke({ plugin_id: bot.plugin_id });
      Message.success(t('customerService.channels.deleted', { defaultValue: '机器人已删除' }));
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingId(null);
      await refreshAll();
    }
  };

  const configTitle =
    activeMeta != null
      ? t(activeMeta.titleKey, activeMeta.fallback)
      : t('customerService.channels.extFallbackName', { defaultValue: '自定义渠道' });

  return (
    <div className='w-full min-h-full box-border overflow-y-auto px-16px py-20px'>
      <div className='mx-auto flex w-full max-w-[1160px] box-border flex-col gap-16px'>
        {/* Header */}
        <div className='flex items-start justify-between gap-16px flex-wrap'>
          <div className='flex items-center gap-12px min-w-0'>
            <Button size='mini' className='shrink-0' onClick={() => void navigate('/customer-service')}>
              <span className='inline-flex items-center gap-4px'>
                <Left theme='outline' size='13' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
                {t('customerService.channels.back', { defaultValue: '返回客服' })}
              </span>
            </Button>
            <div className='min-w-0'>
              <h1 className={`${HUB_PAGE_TITLE_CLASS} mb-3px`}>
                {t('customerService.channels.title', { defaultValue: '渠道中心' })}
              </h1>
              <p className='m-0 text-13px text-t-secondary leading-19px max-w-[560px]'>
                {t('customerService.channels.subtitle', {
                  defaultValue:
                    '集中接入客服渠道 —— 配置平台凭证、创建渠道机器人、指派给客服接待访客。',
                })}
              </p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className='flex flex-wrap items-center gap-x-20px gap-y-8px rd-14px px-16px py-10px border border-solid'
          style={{
            background: 'linear-gradient(135deg, rgba(var(--primary-6),0.06) 0%, rgba(var(--primary-6),0.02) 100%)',
            borderColor: 'rgba(var(--primary-6),0.18)',
          }}
        >
          <span className='inline-flex items-center gap-7px text-12px text-t-secondary'>
            <Api theme='outline' size='15' fill='rgb(var(--primary-6))' className='block' style={{ lineHeight: 0 }} />
            {t('customerService.channels.stats.bots', {
              defaultValue: '接入 {{count}} 个渠道机器人',
              count: stats.total,
            })}
          </span>
          <span className='inline-flex items-center gap-7px text-12px text-t-secondary'>
            <span className='w-6px h-6px rd-full shrink-0' style={{ background: 'rgb(var(--green-6))' }} />
            {t('customerService.channels.stats.running', {
              defaultValue: '{{count}} 个运行中',
              count: stats.running,
            })}
          </span>
          <span className='inline-flex items-center gap-7px text-12px text-t-secondary'>
            {t('customerService.channels.stats.agents', {
              defaultValue: '覆盖 {{count}} 位客服',
              count: stats.agents,
            })}
          </span>
          {stats.agents === 0 && agents.length === 0 && (
            <span className='text-12px text-t-tertiary'>
              {t('customerService.channels.empty.noAgents', {
                defaultValue: '请先创建客服，再接入渠道机器人。',
              })}
            </span>
          )}
        </div>

        {/* Master-detail */}
        <div className='flex flex-col gap-0 rd-16px overflow-hidden border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] min-h-[480px]'
          style={{ gridTemplateColumns: '280px 1fr' }}
        >
          <div className='flex max-h-[72vh] flex-col border-r border-solid border-[var(--color-border-2)]'>
            <div className='shrink-0 px-14px py-10px text-12px font-600 text-t-secondary border-b border-solid border-[var(--color-border-2)]'>
              {t('customerService.channels.leftHeader', { defaultValue: '渠道' })}
            </div>
            <div className='overflow-y-auto'>
              {platforms.map((entry) => {
                const active = entry.type === activeType;
                const online = entry.bots.some((bot) => bot.enabled && bot.connected);
                const count = entry.bots.length;
                return (
                  <button
                    key={entry.type}
                    type='button'
                    onClick={() => setSelectedType(entry.type)}
                    className={
                      'flex w-full items-center gap-10px px-14px py-10px text-left cursor-pointer outline-none transition-colors border-0 bg-transparent ' +
                      (active
                        ? 'bg-primary-1'
                        : 'hover:bg-[var(--color-fill-1)]')
                    }
                  >
                    {entry.meta ? (
                      <img src={entry.meta.logo} alt='' className='w-22px h-22px shrink-0 object-contain' />
                    ) : (
                      <span className='flex items-center justify-center w-22px h-22px shrink-0 rd-6px text-primary-6 bg-fill-2'>
                        <Api theme='outline' size='15' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
                      </span>
                    )}
                    <span
                      className={
                        'min-w-0 flex-1 truncate text-13px ' +
                        (active ? 'text-primary-6 font-600' : 'text-t-primary')
                      }
                    >
                      {platformName(entry)}
                    </span>
                    {count > 0 ? (
                      <span className='inline-flex shrink-0 items-center gap-5px'>
                        {online && (
                          <span className='w-6px h-6px rd-full' style={{ background: 'rgb(var(--green-6))' }} />
                        )}
                        <Tag size='small' color={active ? 'arcoblue' : 'gray'}>
                          {count}
                        </Tag>
                      </span>
                    ) : (
                      <span className='shrink-0 text-11px text-t-quaternary'>
                        {t('customerService.channels.notConnected', { defaultValue: '未接入' })}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right pane: bots of the selected platform */}
          <div className='flex min-w-0 flex-col'>
            <div className='flex shrink-0 items-center justify-between gap-10px border-b border-solid border-[var(--color-border-2)] px-14px py-10px'>
              <div className='min-w-0 flex items-center gap-8px'>
                {activeMeta && (
                  <img src={activeMeta.logo} alt='' className='w-20px h-20px shrink-0 object-contain' />
                )}
                <span className='truncate text-14px font-600 text-t-primary'>{configTitle}</span>
                <Tag size='small' color='gray' className='shrink-0'>
                  {activeType}
                </Tag>
              </div>
              <div className='flex shrink-0 items-center gap-6px'>
                <Button
                  size='mini'
                  onClick={() => void refreshAll()}
                >
                  <span className='inline-flex items-center gap-4px'>
                    <Refresh theme='outline' size='13' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
                    {t('customerService.channels.refresh', { defaultValue: '刷新' })}
                  </span>
                </Button>
                <Button size='mini' type='primary' disabled={agents.length === 0} onClick={() => setConfigTarget({ platform: activeType as ChannelPlatform })}>
                  <span className='inline-flex items-center gap-4px'>
                    <Plus theme='outline' size='13' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
                    {t('customerService.channels.newOnPlatform', {
                      defaultValue: '新建{{platform}}机器人',
                      platform: configTitle,
                    })}
                  </span>
                </Button>
              </div>
            </div>

            <div className='min-h-0 flex-1 overflow-y-auto p-12px'>
              {agentsLoading || statuses.length === 0 ? (
                <div className='flex justify-center py-48px'>
                  <Spin />
                </div>
              ) : !activePlatform || activePlatform.bots.length === 0 ? (
                <div className='flex flex-col items-center justify-center gap-12px px-24px py-48px text-center'>
                  <Empty
                    description={t('customerService.channels.empty.platformDesc', {
                      defaultValue: '此渠道还没有机器人 —— 点击右上角「新建」配置凭证并接入。',
                      platform: configTitle,
                    })}
                  />
                  {agents.length === 0 && (
                    <Button size='small' onClick={() => void navigate('/customer-service')}>
                      {t('customerService.channels.empty.goCreateAgent', { defaultValue: '去创建客服' })}
                    </Button>
                  )}
                </div>
              ) : (
                <div className='flex flex-col gap-8px'>
                  {activePlatform.bots.map((bot) => {
                    const owner = ownerByBot.get(bot.plugin_id) ?? '';
                    return (
                      <div
                        key={bot.plugin_id}
                        className='flex items-center gap-10px text-13px text-t-primary flex-wrap rd-12px border border-solid border-[var(--color-border-2)] px-12px py-10px'
                      >
                        <span className='min-w-0 max-w-[200px] truncate font-500'>{botName(bot)}</span>
                        <Tag size='small' className='shrink-0'>
                          {bot.type}
                        </Tag>
                        {statusTag(bot)}
                        <span className='text-12px text-t-tertiary shrink-0'>
                          {t('customerService.channels.row.bind', { defaultValue: '绑定客服' })}:
                        </span>
                        <Select
                          size='mini'
                          className='w-150px shrink-0'
                          placeholder={t('customerService.channels.row.bindPlaceholder', {
                            defaultValue: '指派客服…',
                          })}
                          value={owner}
                          disabled={Boolean(rebindingId) || agents.length === 0}
                          onChange={(value: unknown) => void rebindBot(bot, (value as CsAgentId) ?? '')}
                        >
                          {agents.map((agent) => (
                            <Select.Option key={agent.cs_agent_id} value={agent.cs_agent_id}>
                              {agent.name}
                            </Select.Option>
                          ))}
                        </Select>
                        <div className='ml-auto flex shrink-0 items-center gap-6px'>
                          {activeMeta && (
                            <Button
                              size='mini'
                              onClick={() =>
                                setConfigTarget({
                                  platform: activeType as ChannelPlatform,
                                  channelPluginId: bot.plugin_id,
                                })
                              }
                            >
                              {t('customerService.channels.row.configure', { defaultValue: '配置' })}
                            </Button>
                          )}
                          <Popconfirm
                            title={t('customerService.channels.row.deleteConfirm', {
                              defaultValue: '删除该机器人将断开其全部会话与访客，确认删除？',
                            })}
                            okButtonProps={{ status: 'danger' }}
                            onOk={() => void deleteBot(bot)}
                          >
                            <Button size='mini' status='danger' loading={deletingId === bot.plugin_id}>
                              {t('customerService.channels.row.delete', { defaultValue: '删除' })}
                            </Button>
                          </Popconfirm>
                        </div>
                      </div>
                    );
                  })}
                  <div className='text-12px text-t-quaternary px-4px'>
                    {t('customerService.channels.row.hint', {
                      defaultValue: '绑定后，该机器人的来访消息会交给所选客服接待（陌生访客免配对码）。改绑会把机器人从原客服名下移除。',
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 渠道配置（创建 / 编辑）——复用共享配置面，寻址客服域 */}
      <NomiModal
        visible={Boolean(configTarget)}
        onCancel={() => {
          setConfigTarget(null);
          void refreshAll();
        }}
        header={{
          title: t('geekclaw.settings.remoteConfigTitle', { channel: configTitle }),
          showClose: true,
        }}
        footer={null}
        style={{ width: 720 }}
        contentStyle={{ maxHeight: 'calc(80vh - 80px)', padding: '0 2px' }}
      >
        {configTarget && (
          <PlatformConfigBody
            key={configTarget.channelPluginId ?? `${configTarget.platform}:new`}
            platform={configTarget.platform}
            status={
              configTarget.channelPluginId
                ? (statuses.find((s) => s.plugin_id === configTarget.channelPluginId) ?? null)
                : null
            }
            channelTarget={{
              channelPluginId: configTarget.channelPluginId,
              ownerDomain: 'customer_service',
            }}
            onStatusChange={(status) => {
              // 只采纳客服域行；伙伴域 bot 不把弹窗重定向到错误实体。
              if (status && statusInOwnerDomain(status, 'customer_service')) {
                setStatuses((prev) => [
                  ...prev.filter((s) => s.plugin_id !== status.plugin_id),
                  status,
                ]);
                setConfigTarget((prev) => retargetConfigAfterStatus(prev, status));
              }
              void refreshAll();
            }}
            refreshStatuses={refreshAll}
          />
        )}
      </NomiModal>
    </div>
  );
};

export default CsChannelsPage;
