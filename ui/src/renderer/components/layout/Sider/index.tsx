/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Box } from '@icon-park/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { cleanupSiderTooltips, getSiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { blurActiveElement } from '@renderer/utils/ui/focus';
import { useKnowledgeInboxPending } from '@renderer/pages/knowledge/useKnowledge';
import {
  SiderAssetLibraryEntry,
  SiderPresetEntry,
  SiderSkillsEntry,
  SiderConversationEntry,
  SiderCustomerServiceEntry,
  SiderKnowledgeEntry,
  SiderMcpEntry,
  SiderModelHubEntry,
  SiderNomiEntry,
  SiderRequirementsEntry,
  SiderScheduledEntry,
  SiderSectionHeader,
  SiderSettingsEntry,
  SiderWorkshopEntry,
  SiderExpertAgentsEntry,
  SiderUserManagementEntry,
  SiderWorkCommunityEntry,
  SiderForeignTradeEntry,
} from './SiderNav';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import SiderThemeControl from './SiderThemeControl';

const SettingsSider = React.lazy(() => import('@renderer/pages/settings/components/SettingsSider'));

interface SiderProps {
  onSessionClick?: () => void;
  collapsed?: boolean;
}

/**
 * Sider — the app-level primary navigation rail.
 *
 * Slimmed down to a pure capability rail: the conversation/terminal session
 * list, the create switches, and full-text search were lifted out into the
 * content-area secondary sidebar (`ConversationShell` / `ContentSider`),
 * reached via the "会话" entry. The rail holds top-level destinations grouped
 * by small-text section headers (`SiderSectionHeader`): 常用 (会话 / 桌面伙伴),
 * 数据空间 (知识库 / 数字资产库), Work++工作平台 (Work++社区 / A2A跨境电商 / 龙虾盒子),
 * 增强工具 (设定 / Skill / MCP / 定时任务), 服务 (客服).
 *
 * The former bottom-pinned 设置 group (browser / model hub / open capabilities /
 * settings / logout) has moved into the `UserMenu` anchored at the bottom-left
 * of `Layout`, leaving this rail focused on primary destinations.
 */
const Sider: React.FC<SiderProps> = ({ onSessionClick, collapsed = false }) => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const { pathname } = useLocation();
  const isSettings = pathname.startsWith('/settings');
  const { count: pendingInboxCount } = useKnowledgeInboxPending();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const navigate = useNavigate();

  const navTo = useCallback(
    (target: string) => {
      cleanupSiderTooltips();
      blurActiveElement();
      Promise.resolve(navigate(target)).catch((error) => {
        console.error('Navigation failed:', error);
      });
      if (onSessionClick) {
        onSessionClick();
      }
    },
    [navigate, onSessionClick]
  );

  const handleConversationClick = () => navTo('/guid');
  const handleWorkCommunityClick = () => navTo('/work-community');
  const handleForeignTradeClick = () => navTo('/foreign-trade');
  const handleScheduledClick = () => navTo('/scheduled');
  const handleRequirementsClick = () => navTo('/requirements');
  const handleKnowledgeClick = () => navTo('/knowledge');
  const handleAssetLibraryClick = () => navTo('/assets');
  const handleNomiClick = () => navTo('/geekclaw');
  const handleWorkshopClick = () => navTo('/workshop');
  const handleCustomerServiceClick = () => navTo('/customer-service');
  const handleModelHubClick = () => navTo('/models');
  const handleSettingsClick = () => navTo('/settings/system');
  const handlePresetClick = () => navTo('/presets');
  const handleSkillsClick = () => navTo('/skills');
  const handleMcpClick = () => navTo('/mcp');
  const handleLobsterClick = () => navTo('/lobster');
  const handleExpertAgentsClick = () => navTo('/expert-agents');
  const handleUserManagementClick = () => navTo('/user-management');

  const tooltipEnabled = collapsed && !isMobile;
  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);

  // The "会话" entry stays active across every route owned by ConversationShell.
  const isSessionRoute =
    pathname === '/guid' ||
    pathname.startsWith('/conversation/') ||
    pathname === '/terminal-new' ||
    pathname.startsWith('/terminal/');

  return (
    <div className='size-full flex flex-col'>
      {/* Main content area */}
      <div className='flex-1 min-h-0 overflow-y-auto overflow-x-hidden'>
        {isSettings ? (
          <Suspense fallback={<div className='size-full' />}>
            <SettingsSider collapsed={collapsed} tooltipEnabled={tooltipEnabled} />
          </Suspense>
        ) : (
          <div className='size-full flex flex-col gap-1px'>
            {/* 常用 — high-frequency primary destinations */}
            <SiderSectionHeader label={t('common.siderSection.common')} collapsed={collapsed} />
            {/* Conversations — opens the session secondary sidebar (ContentSider) */}
            <SiderConversationEntry
              isMobile={isMobile}
              isActive={isSessionRoute}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleConversationClick}
            />
            {/* Work partner (桌面伙伴) */}
            <SiderNomiEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/geekclaw')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleNomiClick}
            />
            {/* 极客出海 Agent (跨境外贸专家分身智能体) */}
            <SiderExpertAgentsEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/expert-agents')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleExpertAgentsClick}
            />
            {/* 用户管理 (User Management) — admin-only control plane */}
            {isAdmin && (
              <SiderUserManagementEntry
                isMobile={isMobile}
                isActive={pathname.startsWith('/user-management')}
                collapsed={collapsed}
                siderTooltipProps={siderTooltipProps}
                onClick={handleUserManagementClick}
              />
            )}
            {/* Creative Workshop (创意工坊) — infinite-canvas AI creation surface */}
            <SiderWorkshopEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/workshop')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleWorkshopClick}
            />
            {/* 数据空间 — data & storage (文件管理 reserved for later) */}
            <SiderSectionHeader label={t('common.siderSection.data')} collapsed={collapsed} />
            {/* Knowledge base */}
            <SiderKnowledgeEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/knowledge')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleKnowledgeClick}
              dot={pendingInboxCount > 0}
            />
            {/* Asset library — unified management of creative-workshop assets */}
            <SiderAssetLibraryEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/assets')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleAssetLibraryClick}
            />
            {/* Work++工作平台 — automation platforms */}
            <SiderSectionHeader label={t('common.siderSection.automation')} collapsed={collapsed} />
            {/* Work++社区 */}
            <SiderWorkCommunityEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/work-community')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleWorkCommunityClick}
            />
            {/* AI 外贸工作台 — GeekFlow 外贸工作台入口 */}
            <SiderForeignTradeEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/foreign-trade')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleForeignTradeClick}
            />
            {/* Requirements platform (A2A跨境电商) */}
            <SiderRequirementsEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/requirements')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleRequirementsClick}
            />
            {/* 龙虾盒子 — Lobster Box (under A2A跨境电商) */}
            <div
              className={classNames(
                'box-border group h-32px w-full flex items-center justify-start gap-8px pl-10px pr-8px rd-0.5rem cursor-pointer shrink-0 transition-all text-t-primary',
                isMobile && 'sider-action-btn-mobile',
                pathname.startsWith('/lobster') ? '!bg-primary-1 !text-primary-6' : 'hover:bg-fill-2 active:bg-fill-3'
              )}
              onClick={handleLobsterClick}
            >
              <span className='size-22px flex items-center justify-center shrink-0'>
                <Box theme='outline' size='16' fill='currentColor' className='block leading-none' style={{ lineHeight: 0 }} />
              </span>
              <span className='collapsed-hidden text-14px font-[500] leading-24px'>龙虾盒子</span>
            </div>
            {/* 增强工具 — extension capabilities */}
            <SiderSectionHeader label={t('common.siderSection.tools')} collapsed={collapsed} />
            {/* Presets and skills are separate concepts and destinations. */}
            <SiderPresetEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/presets')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handlePresetClick}
            />
            <SiderSkillsEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/skills')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleSkillsClick}
            />
            {/* MCP — MCP tool server configuration */}
            <SiderMcpEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/mcp')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleMcpClick}
            />
            {/* 定时任务 — Scheduled tasks (under MCP) */}
            <SiderScheduledEntry
              isMobile={isMobile}
              isActive={pathname === '/scheduled'}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleScheduledClick}
            />
            {/* 服务 — public-facing services (客服 / 模型管理 / 系统设置),
                a domain fully separate from the desktop-companion group above. */}
            <SiderSectionHeader label={t('common.siderSection.services')} collapsed={collapsed} />
            <SiderCustomerServiceEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/customer-service')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleCustomerServiceClick}
            />
            {/* 模型管理 — API Key / provider configuration (模型管理) */}
            <SiderModelHubEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/models')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleModelHubClick}
            />
            {/* 系统设置 — app-level settings (系统设置) */}
            <SiderSettingsEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/settings')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleSettingsClick}
            />
          </div>
        )}
      </div>

      {/* Footer — appearance (light/dark + scaling + CSS presets) quick access.
          The rest of the former bottom settings group lives in the UserMenu. */}
      <div className='shrink-0 mt-auto border-t border-[var(--color-border-2)]'>
        <SiderThemeControl isMobile={isMobile} collapsed={collapsed} siderTooltipProps={siderTooltipProps} />
      </div>
    </div>
  );
};

export default Sider;
