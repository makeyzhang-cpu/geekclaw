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
  SiderSkillsEntry,
  SiderConversationEntry,
  SiderCustomerServiceEntry,
  SiderKnowledgeEntry,
  SiderMcpEntry,
  SiderNomiEntry,
  SiderOpcEntry,
  SiderPresetEntry,
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
 * by small-text section headers (`SiderSectionHeader`):
 *   FTC通用智能体 (会话 / 数字员工 / 技能 / 设定 / MCP / 定时任务),
 *   极客出海智能体 (外贸专家Agent / AI品牌营销 / B2B外贸工作台 / A2A跨境电商 /
 *     OPC分销工作台 / 端侧智能体盒子),
 *   助理能力仓 (AI创艺工作台 / 知识库 / 数字资产库 / AI客服 / 系统设置).
 * The former bottom-pinned 设置 group (browser / model hub / open capabilities /
 * settings / logout) has moved into the `UserMenu` anchored at the bottom-left
 * of `Layout`. 浏览器 / 远程&开放能力 / 模型管理 now live inside
 * 【系统设置】→「应用」分组（「远程主机」之下）, leaving this rail focused on
 * primary destinations.
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
  const handleRequirementsClick = () => navTo('/a2a-ecommerce');
  const handleOpcClick = () => navTo('/opc-dist');
  const handleKnowledgeClick = () => navTo('/knowledge');
  const handleAssetLibraryClick = () => navTo('/assets');
  const handleNomiClick = () => navTo('/geekclaw');
  const handleWorkshopClick = () => navTo('/workshop');
  const handleCustomerServiceClick = () => navTo('/customer-service');
  const handleSettingsClick = () => navTo('/settings/system');
  const handleSkillsClick = () => navTo('/skills');
  const handlePresetClick = () => navTo('/presets');
  const handleMcpClick = () => navTo('/mcp');
  const handleScheduledClick = () => navTo('/scheduled');
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
            {/* FTC 通用智能体 — high-frequency primary destinations */}
            <SiderSectionHeader label={t('common.siderSection.common')} collapsed={collapsed} />
            {/* Conversations — opens the session secondary sidebar (ContentSider) */}
            <SiderConversationEntry
              isMobile={isMobile}
              isActive={isSessionRoute}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleConversationClick}
            />
            {/* 数字员工 (原桌面伙伴 / geekclaw) */}
            <SiderNomiEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/geekclaw')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleNomiClick}
            />
            {/* 技能 — Skills */}
            <SiderSkillsEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/skills')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleSkillsClick}
            />
            {/* 设定 — Presets (skills / agent presets) */}
            <SiderPresetEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/presets')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handlePresetClick}
            />
            {/* MCP — MCP tool server configuration */}
            <SiderMcpEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/mcp')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleMcpClick}
            />
            {/* 定时任务 — Scheduled tasks */}
            <SiderScheduledEntry
              isMobile={isMobile}
              isActive={pathname === '/scheduled'}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleScheduledClick}
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
            {/* 极客出海智能体 — cross-border export agents & platforms */}
            <SiderSectionHeader label={t('common.siderSection.automation')} collapsed={collapsed} />
            {/* 外贸专家 Agent (跨境外贸专家分身智能体) */}
            <SiderExpertAgentsEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/expert-agents')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleExpertAgentsClick}
            />
            {/* AI 品牌营销 — Work++社区 */}
            <SiderWorkCommunityEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/work-community')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleWorkCommunityClick}
            />
            {/* B2B 外贸工作台 — GeekFlow 外贸工作台入口 */}
            <SiderForeignTradeEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/foreign-trade')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleForeignTradeClick}
            />
            {/* A2A 跨境电商平台 — 与「B2B 外贸工作台」同形态：入口卡片 + 应用内 Webview 打开 niushitv */}
            <SiderRequirementsEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/a2a-ecommerce')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleRequirementsClick}
            />
            {/* OPC 分销工作台 — One Person Company 全球分销协作 */}
            <SiderOpcEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/opc-dist')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleOpcClick}
            />
            {/* 端侧智能体盒子 — Edge Agent Box (kept under automation group) */}
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
              <span className='collapsed-hidden text-14px font-[500] leading-24px'>端侧智能体盒子</span>
            </div>
            {/* 助理能力仓 — AI 创作 / 知识 / 资产 / 客服 / 设置的统一收口 */}
            <SiderSectionHeader label={t('common.siderSection.assistantVault')} collapsed={collapsed} />
            {/* AI 创艺工作台 — infinite-canvas AI creation surface */}
            <SiderWorkshopEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/workshop')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleWorkshopClick}
            />
            {/* 知识库 — Knowledge base */}
            <SiderKnowledgeEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/knowledge')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleKnowledgeClick}
              dot={pendingInboxCount > 0}
            />
            {/* 数字资产库 — unified management of creative-workshop assets */}
            <SiderAssetLibraryEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/assets')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleAssetLibraryClick}
            />
            {/* AI 客服 — public-facing customer service */}
            <SiderCustomerServiceEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/customer-service')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleCustomerServiceClick}
            />
            {/* 系统设置 — 浏览器 / 远程&开放能力 / 模型管理
                已统一收进【系统设置】→「应用」分组（「远程主机」之下），不再占用主栏；
                「设定」「定时任务」仍留在上方 FTC 通用智能体分组。 */}
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
