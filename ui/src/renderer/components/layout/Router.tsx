import React, { Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import AppLoader from '@renderer/components/layout/AppLoader';
import RouteErrorBoundary from '@renderer/components/layout/RouteErrorBoundary';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { useCompanionWindowsSync } from '@renderer/hooks/useCompanionWindowsSync';
import { useTrayLabels } from '@renderer/hooks/useTrayLabels';
import { isTauriRuntime } from '@/common/adapter/tauriRuntime';
const Conversation = React.lazy(() => import('@renderer/pages/conversation'));
const Guid = React.lazy(() => import('@renderer/pages/guid'));
const PresetSettings = React.lazy(() => import('@renderer/pages/settings/PresetSettings'));
const SkillsSettingsPage = React.lazy(() => import('@renderer/pages/settings/SkillsSettingsPage'));
const ModelHubPage = React.lazy(() => import('@renderer/pages/modelHub'));
const McpPage = React.lazy(() => import('@renderer/pages/mcp'));
const OpenCapabilitiesPage = React.lazy(() => import('@renderer/pages/openCapabilities'));
const BrowserPage = React.lazy(() => import('@renderer/pages/browser'));
const SystemSettings = React.lazy(() => import('@renderer/pages/settings/SystemSettings'));
const ExecutionEngineSettings = React.lazy(() => import('@renderer/pages/settings/AgentSettings'));
const SshHostSettings = React.lazy(() => import('@renderer/pages/settings/SshHostSettings'));
const ExtensionSettingsPage = React.lazy(() => import('@renderer/pages/settings/ExtensionSettingsPage'));
const LoginPage = React.lazy(() => import('@renderer/pages/login'));
const ComponentsShowcase = React.lazy(() => import('@renderer/pages/TestShowcase'));
const ScheduledTasksPage = React.lazy(() => import('@renderer/pages/cron/ScheduledTasksPage'));
const WorkCommunityPage = React.lazy(() => import('@renderer/pages/work-community'));
const ForeignTradePage = React.lazy(() => import('@renderer/pages/foreign-trade'));
const TaskDetailPage = React.lazy(() => import('@renderer/pages/cron/ScheduledTasksPage/TaskDetailPage'));
const ComingSoon = React.lazy(() => import('@renderer/components/ComingSoon'));
const WorkshopHomePage = React.lazy(() => import('@renderer/pages/workshop/WorkshopHomePage'));
const WorkshopListPage = React.lazy(() => import('@renderer/pages/workshop'));
const ReferralPage = React.lazy(() => import('@renderer/pages/referral'));
const LobsterPage = React.lazy(() => import('@renderer/pages/lobster'));
const TerminalSessionPage = React.lazy(() => import('@renderer/pages/terminal/TerminalSessionPage'));
const TerminalCreatePage = React.lazy(() => import('@renderer/pages/terminal/TerminalCreatePage'));
const NomiConfigPage = React.lazy(() => import('@renderer/pages/geekclaw'));
const CustomerServiceHomePage = React.lazy(() => import('@renderer/pages/customerService/CsHomePage'));
const CustomerServiceRosterPage = React.lazy(() => import('@renderer/pages/customerService'));
const CustomerServiceDetailPage = React.lazy(() => import('@renderer/pages/customerService/CsAgentDetailPage'));
const CustomerServiceChatPage = React.lazy(() => import('@renderer/pages/customerService/CsChatPage'));
const CustomerServiceWorkbenchPage = React.lazy(() => import('@renderer/pages/customerService/CsWorkbenchPage'));
const CustomerServiceChannelsPage = React.lazy(() => import('@renderer/pages/customerService/CsChannelsPage'));
const TicketsPage = React.lazy(() => import('@renderer/pages/customerService/TicketsPage'));
const KnowledgeListPage = React.lazy(() => import('@renderer/pages/knowledge/KnowledgeListPage'));
const KnowledgeDetailPage = React.lazy(() => import('@renderer/pages/knowledge/KnowledgeDetailPage'));
// 创意工坊 / A2A 跨境电商 当前以 ComingSoon 占位，避免加载庞大的旧模块
// Workshop / A2A are intentionally shown as "功能开发中" placeholders.
const AssetLibraryPage = React.lazy(() => import('@renderer/pages/assets'));
const CompanionPage = React.lazy(() => import('@renderer/pages/companion'));
const ConversationShell = React.lazy(() => import('@renderer/pages/conversation/components/ConversationShell'));
const ExpertAgentsPage = React.lazy(() => import('@renderer/pages/expert-agents'));
const ExpertMarketPage = React.lazy(() => import('@renderer/pages/expert-market'));
const RegisterPage = React.lazy(() => import('@renderer/pages/register'));
const ActivatePage = React.lazy(() => import('@renderer/pages/activate'));
const UserManagementPage = React.lazy(() => import('@renderer/pages/userManagement'));
const BillingPage = React.lazy(() => import('@renderer/pages/billing'));
const PricingPage = React.lazy(() => import('@renderer/pages/pricing'));

const RouteFallback: React.FC<{ Component: React.LazyExoticComponent<React.ComponentType> }> = ({ Component }) => {
  const location = useLocation();
  const resetKey = `${location.pathname}${location.search}${location.hash}`;

  return (
    <RouteErrorBoundary resetKey={resetKey}>
      <Suspense fallback={<AppLoader />}>
        <Component />
      </Suspense>
    </RouteErrorBoundary>
  );
};

const withRouteFallback = (Component: React.LazyExoticComponent<React.ComponentType>) => (
  <RouteFallback Component={Component} />
);

const SessionShellRoute: React.FC = () => {
  const location = useLocation();
  const resetKey = `${location.pathname}${location.search}${location.hash}`;

  return (
    <RouteErrorBoundary resetKey={resetKey}>
      <Suspense fallback={<AppLoader />}>
        <ConversationShell />
      </Suspense>
    </RouteErrorBoundary>
  );
};

const withSearch = (path: string, searchParams: URLSearchParams) => {
  const search = searchParams.toString();
  return search ? `${path}?${search}` : path;
};

/** Preserve local/remote tab deep links from the former settings route. */
const LegacyExecutionEngineRedirect: React.FC = () => {
  const { search } = useLocation();
  return <Navigate to={`/settings/execution-engines${search}`} replace />;
};

const LegacyExtensionsRedirect: React.FC = () => {
  const { search } = useLocation();
  const searchParams = new URLSearchParams(search);
  const tab = searchParams.get('tab');
  searchParams.delete('tab');

  if (tab === 'tools') {
    return <Navigate to={withSearch('/mcp', searchParams)} replace />;
  }

  return <Navigate to={withSearch('/skills', searchParams)} replace />;
};

// Legacy `/requirements/:id/edit` deep links → open the workspace with the
// requirement pre-selected in edit mode (the new shell hosts editing in a
// drawer, not a standalone form page).
const RequirementEditRedirect: React.FC = () => {
  const { id } = useParams();
  return <Navigate to={`/requirements?req=${id}&edit=1`} replace />;
};

const getHashRouteRedirectUrl = () => {
  if (typeof window === 'undefined') return null;
  if (!['http:', 'https:'].includes(window.location.protocol)) return null;
  if (window.location.hash) return null;

  const { origin, pathname, search } = window.location;
  if (pathname === '/' || pathname.endsWith('/index.html')) return null;

  return `${origin}/#${pathname}${search}`;
};

const ProtectedLayout: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();

  if (status === 'checking') {
    return <AppLoader />;
  }

  if (status !== 'authenticated') {
    return <Navigate to='/login' replace />;
  }

  return (
    <>
      <CompanionNavigateListener />
      <CompanionWindowsSyncMount />
      <TrayLabelsMount />
      {React.cloneElement(layout)}
    </>
  );
};

// Owns the native desktop-companion window set from the main window: reconciles one
// `companion-{companion_id}` Tauri window per enabled companion (useCompanionWindowsSync). Inert
// outside the Tauri desktop shell.
const CompanionWindowsSyncMount: React.FC = () => {
  useCompanionWindowsSync();
  return null;
};

// Keeps the native system-tray menu labels (Show / Quit) in sync with the UI
// locale. Inert outside the Tauri desktop shell.
const TrayLabelsMount: React.FC = () => {
  useTrayLabels();
  return null;
};

// Listens for "companion-navigate" Tauri events emitted by the companion window (a click
// on the companion bubble / its context menu) and routes the main window.
// Inert outside the Tauri desktop shell.
const CompanionNavigateListener: React.FC = () => {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<string>('companion-navigate', (event) => {
        if (typeof event.payload === 'string' && event.payload.startsWith('/')) {
          void navigate(event.payload);
        }
      }).then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
    );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [navigate]);
  return null;
};

const PanelRoute: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();
  const hashRouteRedirectUrl = getHashRouteRedirectUrl();

  if (hashRouteRedirectUrl) {
    window.location.replace(hashRouteRedirectUrl);
    return <AppLoader />;
  }

  return (
    <HashRouter>
      <Routes>
        <Route
          path='/login'
          element={status === 'authenticated' ? <Navigate to='/guid' replace /> : withRouteFallback(LoginPage)}
        />
        <Route
          path='/register'
          element={status === 'authenticated' ? <Navigate to='/guid' replace /> : withRouteFallback(RegisterPage)}
        />
        {/* The desktop-companion window route: fullscreen transparent, no app layout/sidebar. */}
        <Route path='/companion' element={withRouteFallback(CompanionPage)} />
        <Route element={<ProtectedLayout layout={layout} />}>
          <Route index element={<Navigate to='/guid' replace />} />
          {/* Models, presets, skills, and MCP are independent top-level capabilities. */}
          <Route path='/models' element={withRouteFallback(ModelHubPage)} />
          <Route path='/extensions' element={<LegacyExtensionsRedirect />} />
          <Route path='/mcp' element={withRouteFallback(McpPage)} />
          <Route path='/open-capabilities' element={withRouteFallback(OpenCapabilitiesPage)} />
          <Route path='/browser' element={withRouteFallback(BrowserPage)} />
          {/* Offline license activation / upgrade entry */}
          <Route path='/activate' element={withRouteFallback(ActivatePage)} />
          <Route path='/expert-agents' element={withRouteFallback(ExpertAgentsPage)} />
          <Route path='/expert-market' element={withRouteFallback(ExpertMarketPage)} />
          <Route path='/presets' element={withRouteFallback(PresetSettings)} />
          <Route path='/skills' element={withRouteFallback(SkillsSettingsPage)} />
          {/* Session section — the secondary sidebar (ContentSider) persists across these routes */}
          <Route element={<SessionShellRoute />}>
            <Route path='/guid' element={withRouteFallback(Guid)} />
            <Route path='/conversation/:id' element={withRouteFallback(Conversation)} />
            <Route path='/terminal-new' element={withRouteFallback(TerminalCreatePage)} />
            <Route path='/terminal/:id' element={withRouteFallback(TerminalSessionPage)} />
          </Route>
          {/* Relocated to the capability rail. */}
          <Route path='/settings/model' element={<Navigate to='/models?section=models' replace />} />
          <Route path='/settings/agent' element={<LegacyExecutionEngineRedirect />} />
          <Route path='/settings/capabilities' element={<Navigate to='/skills' replace />} />
          <Route path='/settings/skills-hub' element={<Navigate to='/skills' replace />} />
          <Route path='/settings/tools' element={<Navigate to='/open-capabilities' replace />} />
          <Route path='/settings/display' element={<Navigate to='/settings/system' replace />} />
          <Route path='/settings/webui' element={<Navigate to='/open-capabilities' replace />} />
          <Route path='/settings/system' element={withRouteFallback(SystemSettings)} />
          <Route path='/settings/execution-engines' element={withRouteFallback(ExecutionEngineSettings)} />
          <Route path='/settings/ssh-hosts' element={withRouteFallback(SshHostSettings)} />
          <Route path='/settings/agent-runtime' element={<Navigate to='/settings/execution-engines?tab=runtime' replace />} />
          <Route path='/settings/browser-use' element={withRouteFallback(SystemSettings)} />
          <Route path='/settings/computer-use' element={withRouteFallback(SystemSettings)} />
          <Route path='/settings/ext/:tabId' element={withRouteFallback(ExtensionSettingsPage)} />
          <Route path='/settings/webhook' element={<Navigate to='/requirements/extensions?tab=notify' replace />} />
          <Route path='/settings' element={<Navigate to='/settings/system' replace />} />
          <Route path='/test/components' element={withRouteFallback(ComponentsShowcase)} />
          <Route path='/work-community' element={withRouteFallback(WorkCommunityPage)} />
          <Route path='/foreign-trade' element={withRouteFallback(ForeignTradePage)} />
          <Route path='/scheduled' element={withRouteFallback(ScheduledTasksPage)} />
          <Route path='/scheduled/:cron_job_id' element={withRouteFallback(TaskDetailPage)} />
          {/* A2A 跨境电商 — 暂时以占位页呈现，后续接入正式能力 */}
          <Route path='/requirements' element={withRouteFallback(ComingSoon)} />
          {/* Legacy requirement routes → fold into the new shell (preserve deep links) */}
          <Route path='/requirements/extensions' element={<Navigate to='/requirements' replace />} />
          <Route path='/requirements/sources' element={<Navigate to='/requirements' replace />} />
          <Route path='/requirements/kanban' element={<Navigate to='/requirements?view=board' replace />} />
          <Route path='/requirements/new' element={<Navigate to='/requirements?new=1' replace />} />
          <Route path='/requirements/:id/edit' element={<RequirementEditRedirect />} />
          <Route path='/requirements/tag-sessions' element={<Navigate to='/requirements/extensions?tab=autowork' replace />} />
          <Route path='/autowork' element={<Navigate to='/requirements/extensions?tab=autowork' replace />} />
          {/* Webhook config relocated into 扩展能力 */}
          <Route path='/other' element={<Navigate to='/requirements/extensions?tab=notify' replace />} />
          <Route path='/geekclaw' element={withRouteFallback(NomiConfigPage)} />
          {/* 用户管理 (User Management) — admin-only; guarded inside the page too. */}
          <Route path='/user-management' element={withRouteFallback(UserManagementPage)} />
          {/* 我的积分 / 计费 (Billing) — wallet + ledger; admin-only management panel inside. */}
          <Route path='/billing' element={withRouteFallback(BillingPage)} />
          {/* 套餐与定价 (Pricing) — public marketing tiers; CTA routes to /activate. */}
          <Route path='/pricing' element={withRouteFallback(PricingPage)} />
          {/* 客服 (Customer Service) — a first-class domain separate from desktop companions. */}
          <Route path='/customer-service' element={withRouteFallback(CustomerServiceHomePage)} />
          <Route path='/customer-service/roster' element={withRouteFallback(CustomerServiceRosterPage)} />
          <Route path='/customer-service/channels' element={withRouteFallback(CustomerServiceChannelsPage)} />
          <Route path='/customer-service/tickets' element={withRouteFallback(TicketsPage)} />
          <Route path='/customer-service/:cs_agent_id' element={withRouteFallback(CustomerServiceDetailPage)} />
          <Route path='/customer-service/:cs_agent_id/chat' element={withRouteFallback(CustomerServiceChatPage)} />
          <Route path='/customer-service/:cs_agent_id/workbench' element={withRouteFallback(CustomerServiceWorkbenchPage)} />
          <Route path='/knowledge' element={withRouteFallback(KnowledgeListPage)} />
          <Route path='/knowledge/:id' element={withRouteFallback(KnowledgeDetailPage)} />
          {/* 资产库 (Asset Library) — platform-level management of workshop assets. */}
          <Route path='/assets' element={withRouteFallback(AssetLibraryPage)} />
          {/* 创意工坊 (Creative Workshop) — 5.0.26 接入云端 video.geekclaw.ai。
              /workshop → 云端入口页（WebviewHost + 浏览器跳转）；
              /workshop/:id → 保留原 WorkshopListPage（深链接兼容）。 */}
          <Route path='/workshop' element={withRouteFallback(WorkshopHomePage)} />
          <Route path='/workshop/:id/*' element={withRouteFallback(WorkshopListPage)} />
          {/* 分享邀约有奖分销 (Referral / affiliate) */}
          <Route path='/referral' element={withRouteFallback(ReferralPage)} />
          {/* 龙虾盒子 (Lobster Box) */}
          <Route path='/lobster' element={withRouteFallback(LobsterPage)} />
        </Route>
        <Route path='*' element={<Navigate to={status === 'authenticated' ? '/guid' : '/login'} replace />} />
      </Routes>
    </HashRouter>
  );
};

export default PanelRoute;
