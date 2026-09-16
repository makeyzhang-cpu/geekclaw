/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { cleanupSiderTooltips, getSiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { blurActiveElement } from '@renderer/utils/ui/focus';
import { useKnowledgeInboxPending } from '@renderer/pages/knowledge/useKnowledge';
import {
  SiderAssetLibraryEntry,
  SiderGeoDomesticEntry,
  SiderSkillsEntry,
  SiderConversationEntry,
  SiderCustomerServiceEntry,
  SiderKnowledgeEntry,
  SiderMcpEntry,
  SiderNomiEntry,
  SiderOpcEntry,
  SiderFactorySupplyEntry,
  SiderPresetEntry,
  SiderRequirementsEntry,
  SiderScheduledEntry,
  SiderSectionHeader,
  SiderSettingsEntry,
  SiderWorkshopEntry,
  SiderUserManagementEntry,
  SiderWorkCommunityEntry,
  SiderForeignTradeEntry,
  SiderTradeFollowUpEntry,
  SiderTradeKnowledgeEntry,
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
 *   AI通用智能体 (会话 / 数字员工 / 技能 / 设定 / MCP / 定时任务),
 *   AI出海智能体 (B2B外贸运营工作台 / B2B外贸业务工作台 / B2B外贸跟单工作台 / 外贸人知识库),
 *   AI跨境电商智能体 (A2A跨境电商 / OPC分销工作台 / AI创艺工作台),
 *   AI营销智能体 (国内GEO AI营销),
 *   助理能力仓 (AI客服 / 知识库 / 数字资产库 / 系统设置).
 * The former bottom-pinned 设置 group (browser / model hub / open capabilities /
 * settings / logout) has moved into the `UserMenu` anchored at the bottom-left
 * of `Layout`. 浏览器 / 远程&开放能力 / 模型管理 now live inside
 * 【系统设置】→「应用」分组（「远程主机」之下）, leaving this rail focused on
 * primary destinations.
 */
/**
 * Route match that respects path **segment** boundaries.
 *
 * ⚠️ A naive `pathname.startsWith(base)` lights up sibling routes: plain
 * `/foreign-trade` is a prefix of `/foreign-trade-ops`, so opening 跟单工作台
 * also highlighted 业务工作台 in the rail (2026-09-16 user report). Requiring
 * either an exact match or a `/` boundary keeps siblings distinct while still
 * covering every nested route (`/customer-service/roster`, …).
 */
const isRouteWithin = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);

const Sider: React.FC<SiderProps> = ({ onSessionClick, collapsed = false }) => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const { pathname } = useLocation();
  /** Segment-safe active check bound to the current location. */
  const isRouteActive = (base: string) => isRouteWithin(pathname, base);
  const isSettings = isRouteActive('/settings');
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
  const handleWorkCommunityClick = () => navTo('/marketing-ops');
  const handleGeoDomesticClick = () => navTo('/geo-domestic');
  const handleForeignTradeClick = () => navTo('/foreign-trade');
  const handleTradeFollowUpClick = () => navTo('/foreign-trade-ops');
  const handleTradeKnowledgeClick = () => navTo('/trade-knowledge');
  const handleRequirementsClick = () => navTo('/a2a-ecommerce');
  const handleFactorySupplyClick = () => navTo('/factory-supply');
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
            {/* AI 通用智能体 — high-frequency primary destinations */}
            <SiderSectionHeader label={t('common.siderSection.common')} collapsed={collapsed} />
            {/* Conversations — opens the session secondary sidebar (ContentSider) */}
            <SiderConversationEntry
              isMobile={isMobile}
              isActive={isSessionRoute}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleConversationClick}
            />
            {/* 数字员工 (原数字员工 / geekclaw) */}
            <SiderNomiEntry
              isMobile={isMobile}
              isActive={isRouteActive('/geekclaw')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleNomiClick}
            />
            {/* 技能 — Skills */}
            <SiderSkillsEntry
              isMobile={isMobile}
              isActive={isRouteActive('/skills')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleSkillsClick}
            />
            {/* 设定 — Presets (skills / agent presets) */}
            <SiderPresetEntry
              isMobile={isMobile}
              isActive={isRouteActive('/presets')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handlePresetClick}
            />
            {/* MCP — MCP tool server configuration */}
            <SiderMcpEntry
              isMobile={isMobile}
              isActive={isRouteActive('/mcp')}
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
                isActive={isRouteActive('/user-management')}
                collapsed={collapsed}
                siderTooltipProps={siderTooltipProps}
                onClick={handleUserManagementClick}
              />
            )}
            {/* AI出海智能体 — 外贸经营 / 外贸履约两个专家工作台 */}
            <SiderSectionHeader label={t('common.siderSection.automation')} collapsed={collapsed} />
            {/* B2B外贸运营工作台 — 营销运营专家名册 + 内嵌对话，
                页内独立平台入口 =「专业营销系统」（国际GEO AI营销）。 */}
            <SiderWorkCommunityEntry
              isMobile={isMobile}
              isActive={isRouteActive('/marketing-ops')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleWorkCommunityClick}
            />
            {/* B2B外贸业务工作台 — 外贸专家名册 + 内嵌对话，
                页内独立平台入口 =「GeekLink 专业外贸系统」。 */}
            <SiderForeignTradeEntry
              isMobile={isMobile}
              isActive={isRouteActive('/foreign-trade')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleForeignTradeClick}
            />
            {/* B2B外贸跟单工作台 — 19 种外贸单证生成 + 订单跟单台账，
                单证引擎内置（离线可用），不依赖任何外部站点。 */}
            <SiderTradeFollowUpEntry
              isMobile={isMobile}
              isActive={isRouteActive('/foreign-trade-ops')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleTradeFollowUpClick}
            />
            {/* 外贸人知识库 — 随包内置的外贸业务表格 / 文档模板库：在线查阅 + 直接下载。 */}
            <SiderTradeKnowledgeEntry
              isMobile={isMobile}
              isActive={isRouteActive('/trade-knowledge')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleTradeKnowledgeClick}
            />
            {/* AI跨境电商智能体 — 跨境电商平台 / 全球分销 / AI 创艺产能 */}
            <SiderSectionHeader label={t('common.siderSection.crossBorder')} collapsed={collapsed} />
            {/* A2A 跨境电商平台 — 应用内 Webview 打开 niushitv */}
            <SiderRequirementsEntry
              isMobile={isMobile}
              isActive={isRouteActive('/a2a-ecommerce')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleRequirementsClick}
            />
            {/* 跨境工厂供货撮合平台 — 工厂货源与跨境卖家的撮合入口 */}
            <SiderFactorySupplyEntry
              isMobile={isMobile}
              isActive={isRouteActive('/factory-supply')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleFactorySupplyClick}
            />
            {/* OPC 分销工作台 — One Person Company 全球分销协作 */}
            <SiderOpcEntry
              isMobile={isMobile}
              isActive={isRouteActive('/opc-dist')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleOpcClick}
            />
            {/* AI 创艺工作台 — infinite-canvas AI creation surface */}
            <SiderWorkshopEntry
              isMobile={isMobile}
              isActive={isRouteActive('/workshop')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleWorkshopClick}
            />
            {/* AI营销智能体 — GEO 营销矩阵的独立板块 */}
            <SiderSectionHeader label={t('common.siderSection.marketing')} collapsed={collapsed} />
            {/* 国内GEO AI营销 — 独立板块，应用内 webview 直开 geekgeo 平台 */}
            <SiderGeoDomesticEntry
              isMobile={isMobile}
              isActive={isRouteActive('/geo-domestic')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleGeoDomesticClick}
            />
            {/* 助理能力仓 — 客服 / 知识 / 资产 / 设置的统一收口 */}
            <SiderSectionHeader label={t('common.siderSection.assistantVault')} collapsed={collapsed} />
            {/* AI 客服 — public-facing customer service */}
            <SiderCustomerServiceEntry
              isMobile={isMobile}
              isActive={isRouteActive('/customer-service')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleCustomerServiceClick}
            />
            {/* 知识库 — Knowledge base */}
            <SiderKnowledgeEntry
              isMobile={isMobile}
              isActive={isRouteActive('/knowledge')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleKnowledgeClick}
              dot={pendingInboxCount > 0}
            />
            {/* 数字资产库 — unified management of creative-workshop assets */}
            <SiderAssetLibraryEntry
              isMobile={isMobile}
              isActive={isRouteActive('/assets')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleAssetLibraryClick}
            />
            {/* 系统设置 — 浏览器 / 远程&开放能力 / 模型管理
                已统一收进【系统设置】→「应用」分组（「远程主机」之下），不再占用主栏；
                「设定」「定时任务」仍留在上方 AI 通用智能体分组。 */}
            <SiderSettingsEntry
              isMobile={isMobile}
              isActive={isRouteActive('/settings')}
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
