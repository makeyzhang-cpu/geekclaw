/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Input, Message, Modal } from '@arco-design/web-react';
import { IconDown } from '@arco-design/web-react/icon';
import {
  CloseOne,
  Crown,
  People,
  SettingTwo,
  Share,
  UpdateRotation,
  Wallet,
  WebPage,
} from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { useUpdateAvailability } from '@renderer/hooks/system/useUpdateAvailability';
import { isBrowserCapabilityUnavailable, useBrowserOverview } from '@renderer/pages/browser/useBrowserInventory';
import AppearancePanel from '@renderer/components/settings/AppearancePanel';
import CssThemeModal from '@renderer/pages/settings/DisplaySettings/CssThemeModal';
import { useCssTheme } from '@renderer/hooks/ui/useCssTheme';
import type { ICssTheme } from '@/common/config/storage';
import { blurActiveElement } from '@renderer/utils/ui/focus';
import { cleanupSiderTooltips } from '@renderer/utils/ui/siderTooltip';
import { isDesktopShell } from '@renderer/utils/platform';
import { parseSessionRoute } from '@renderer/utils/routes/sessionRoute';
import { useCloudAuth } from '@renderer/hooks/context/CloudAuthContext';

interface UserMenuProps {
  collapsed?: boolean;
}

const DEFAULT_USERNAME = 'GeekClaw';
const GUEST_USERNAME = '未登录';
const CLOUD_USER_SUBTITLE = '云端账号';
const GUEST_SUBTITLE = '点击登录';

const UserMenu: React.FC<UserMenuProps> = ({ collapsed = false }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { user, logout, status } = useAuth();
  const updateAvailability = useUpdateAvailability();
  const {
    overview: browserOverview,
    unavailable: browserUnavailable,
    transient: browserOverviewTransient,
    retry: retryBrowserOverview,
  } = useBrowserOverview();
  const browserCapabilityUnavailable = isBrowserCapabilityUnavailable(browserOverview, browserUnavailable);

  const USERNAME_STORAGE_KEY = 'geekclaw.displayUsername';

  const [open, setOpen] = useState(false);
  const [settingsExpanded,  setSettingsExpanded] = useState(true);
  const [localUsername, setLocalUsername] = useState<string | null>(() => {
    try {
      return localStorage.getItem(USERNAME_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const cloud = useCloudAuth();

  const isCloudAuthenticated = cloud.state.authenticated;
  const cloudDisplayName =
    cloud.state.user?.name || cloud.state.user?.username || cloud.state.user?.email || GUEST_USERNAME;

  // A non-authenticated cloud state is unreachable here: the app entry gate
  // (CloudLoginWall in main.tsx) blocks the whole UI until cloud sign-in.
  const username = isCloudAuthenticated
    ? localUsername || cloudDisplayName || GUEST_USERNAME
    : localUsername || GUEST_USERNAME;
  const subtitle = CLOUD_USER_SUBTITLE;
  const showLocalLogout = !isDesktopShell() && status === 'authenticated';

  const closeMenu = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const handleDocClick = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!(event.target instanceof Node)) return;
      if (!containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, [open]);

  const navTo = useCallback(
    (target: string) => {
      cleanupSiderTooltips();
      blurActiveElement();
      Promise.resolve(navigate(target)).catch((error) => {
        console.error('Navigation failed:', error);
      });
      closeMenu();
    },
    [navigate, closeMenu]
  );

  const handleBrowserClick = useCallback(() => {
    if (browserOverviewTransient) {
      void retryBrowserOverview();
    }
    const currentSession = parseSessionRoute(pathname);
    if (currentSession?.kind === 'conversation') {
      navTo(`/browser?conversation_id=${encodeURIComponent(currentSession.id)}`);
      return;
    }
    navTo(pathname === '/browser' && search ? `/browser${search}` : '/browser');
  }, [browserOverviewTransient, retryBrowserOverview, pathname, search, navTo]);

  const handleLogout = useCallback(async () => {
    cleanupSiderTooltips();
    blurActiveElement();
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
    }
    closeMenu();
  }, [logout, closeMenu]);

  const handleOpenUpdateModal = useCallback(() => {
    window.dispatchEvent(new CustomEvent('geekclaw-open-update-modal', { detail: { source: 'user-menu' } }));
    closeMenu();
  }, [closeMenu]);

  // Appearance (外观) — full surface lives in AppearancePanel; the editor modal
  // is rendered at this component root (outside the popup) so it survives the
  // popup unmounting when the user clicks into it.
  const { saveUserTheme, deleteUserTheme } = useCssTheme();
  const [themeModalVisible, setThemeModalVisible] = useState(false);
  const [editingTheme, setEditingTheme] = useState<ICssTheme | null>(null);

  const openThemeModal = useCallback(
    (theme: ICssTheme | null) => {
      setEditingTheme(theme);
      setThemeModalVisible(true);
      closeMenu();
    },
    [closeMenu]
  );

  const closeThemeModal = useCallback(() => {
    setThemeModalVisible(false);
    setEditingTheme(null);
  }, []);

  const handleThemeSave = useCallback(
    async (data: Omit<ICssTheme, 'id' | 'created_at' | 'updated_at' | 'is_preset'>) => {
      await saveUserTheme(data, editingTheme);
      closeThemeModal();
      Message.success(t('common.saveSuccess'));
    },
    [saveUserTheme, editingTheme, closeThemeModal, t]
  );

  const canDeleteTheme = !!editingTheme && !editingTheme.is_preset;
  const handleThemeDelete = useCallback(() => {
    if (!editingTheme || editingTheme.is_preset) return;
    const target = editingTheme;
    Modal.confirm({
      title: t('common.confirmDelete'),
      content: t('settings.cssTheme.deleteConfirm'),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        await deleteUserTheme(target.id);
        closeThemeModal();
        Message.success(t('common.deleteSuccess'));
      },
    });
  }, [editingTheme, deleteUserTheme,  closeThemeModal, t]);

  const menuItemClass =
    'group flex items-center gap-8px px-10px h-34px rounded-8px text-13px text-t-primary cursor-pointer transition-colors hover:bg-fill-2 active:bg-fill-3 border-none bg-transparent p-0 m-0 text-left';
  const menuIconClass = 'size-18px flex items-center justify-center shrink-0 text-t-secondary group-hover:text-t-primary';
  const subMenuItemClass =
    'group flex items-center gap-8px pl-32px pr-10px h-34px rounded-8px text-13px text-t-primary cursor-pointer transition-colors hover:bg-fill-2 active:bg-fill-3 border-none bg-transparent p-0 m-0 text-left';
  const subMenuIconClass =
    'size-16px flex items-center justify-center shrink-0 text-t-tertiary group-hover:text-t-primary';

  const browserVisible =
    !browserCapabilityUnavailable && browserOverview?.supported !== false && browserOverview?.enabled !== false;
  const browserCounts = browserOverview
    ? `${browserOverview.running_lanes ?? 0}/${browserOverview.queued_lanes ?? 0}`
    : '0/0';

  return (
    <div ref={containerRef} className='relative shrink-0 z-30'>
      {/* Trigger */}
      <button
        type='button'
        onClick={() => setOpen((prev) => !prev)}
        className={classNames(
          'w-full flex items-center gap-8px rounded-8px border border-[var(--color-border-2)] bg-[var(--color-bg-2)] px-8px py-7px text-left transition-colors hover:border-[var(--color-primary)]',
          collapsed ? 'justify-center' : 'justify-start'
        )}
        aria-label={t('userMenu.title')}
      >
        <span className='shrink-0 size-26px rounded-full overflow-hidden bg-transparent flex items-center justify-center'>
          <img src='/geekclaw-claw.png' alt='GeekClaw' className='w-full h-full object-contain' />
        </span>
        {!collapsed && (
          <>
            <span className='flex-1 min-w-0 truncate text-13px font-medium text-t-primary'>{username}</span>
            <IconDown
              className={classNames(
                'shrink-0 text-t-tertiary transition-transform duration-200 text-14px',
                open && 'rotate-180'
              )}
            />
          </>
        )}
      </button>

      {/* Popup */}
      {open && (
        <div
          className={classNames(
            'absolute left-0 right-0 bottom-full mb-8px rounded-12px border border-[var(--color-border-2)] bg-[var(--color-bg-1)] shadow-[0_8px_32px_rgba(0,0,0,0.16)] py-10px px-6px flex flex-col gap-6px max-h-[calc(100vh-120px)] overflow-y-auto'
          )}
          style={{ minWidth: 220, width: collapsed ? 220 : '100%' }}
        >
          {/* Header */}
          <div className='flex items-center gap-10px px-10px py-4px'>
            <span className='shrink-0 size-40px rounded-full overflow-hidden bg-transparent flex items-center justify-center'>
              <img src='/geekclaw-claw.png' alt='GeekClaw' className='w-full h-full object-contain' />
            </span>
            <div className='flex-1 min-w-0'>
          <div className='text-15px font-semibold text-t-primary truncate'>{username}</div>
          <div className='text-12px text-t-tertiary truncate'>{subtitle}</div>
          </div>
          </div>

          {/* Quick links */}
          <div className='mx-6px my-2px h-1px bg-[var(--color-border-2)]' />
          <div className='px-4px flex flex-col gap-1px'>
            <div className={menuItemClass} onClick={() => navTo('/referral')}>
              <span className={menuIconClass}>
                <People theme='outline' size='16' fill='currentColor' />
              </span>
              <span className='flex-1 truncate'>{t('userMenu.invite')}</span>
              <span className='text-12px text-t-tertiary'>{t('userMenu.inviteReward')}</span>
            </div>
            <div className={menuItemClass} onClick={() => navTo('/billing')}>
              <span className={menuIconClass}>
                <Wallet theme='outline' size='16' fill='currentColor' />
              </span>
              <span className='flex-1 truncate'>{t('userMenu.points')}</span>
            </div>
            <div className={menuItemClass} onClick={() => navTo('/pricing')}>
              <span className={menuIconClass}>
                <Crown theme='outline' size='16' fill='currentColor' />
              </span>
              <span className='flex-1 truncate'>{t('pricing.menuEntry')}</span>
            </div>
          </div>

          {/* Settings moved from sidebar */}
          <div className='mx-6px my-2px h-1px bg-[var(--color-border-2)]' />
          <div className='px-4px flex flex-col gap-1px'>
            {browserVisible && (
              <button type='button' className={menuItemClass} onClick={handleBrowserClick}>
                <span className={menuIconClass}>
                  <WebPage theme='outline' size='16' fill='currentColor' />
                </span>
                <span className='flex-1 truncate text-left'>{t('browser.sider.label')}</span>
                <span className='text-12px text-t-tertiary'>{browserCounts}</span>
              </button>
            )}
            <button type='button' className={menuItemClass} onClick={() => navTo('/open-capabilities')}>
              <span className={menuIconClass}>
                <Share theme='outline' size='16' fill='currentColor' />
              </span>
              <span className='flex-1 truncate text-left'>
                {t('settings.openCapabilities.railTitle', { defaultValue: '远程&开放能力' })}
              </span>
            </button>
            {/* Settings collapsible subgroup */}
            <button
              type='button'
              className={menuItemClass}
              onClick={() => setSettingsExpanded((prev) => !prev)}
            >
              <span className={menuIconClass}>
                <SettingTwo theme='outline' size='16' fill='currentColor' />
              </span>
              <span className='flex-1 truncate text-left'>{t('common.settings')}</span>
              <IconDown
                className={classNames(
                  'shrink-0 text-t-tertiary transition-transform duration-200 text-12px',
                  settingsExpanded && 'rotate-180'
                )}
              />
            </button>
            {settingsExpanded && (
              <div className='flex flex-col gap-1px'>
                {/* 外观 — full appearance surface (light/dark + scaling + CSS presets) */}
                <div className='mt-2px mb-2px'>
                  <div className='text-12px font-500 text-t-tertiary px-10px pt-2px pb-4px'>{t('userMenu.appearance')}</div>
                  <AppearancePanel onEditTheme={openThemeModal} />
                </div>
                <button type='button' className={subMenuItemClass} onClick={handleOpenUpdateModal}>
                  <span className={subMenuIconClass}>
                    <UpdateRotation theme='outline' size='16' fill='currentColor' />
                  </span>
                  <span className='flex-1 truncate text-left'>{t('userMenu.checkUpdate')}</span>
                  {updateAvailability.available && (
                    <span className='shrink-0 size-8px rounded-full bg-primary-6' aria-label={t('update.availableTitle')} />
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Cloud account / logout */}
          {isCloudAuthenticated ? (
            <button type='button' className={menuItemClass} onClick={() => void cloud.logout()}>
              <span className={menuIconClass}>
                <CloseOne theme='outline' size='16' fill='currentColor' />
              </span>
              <span className='flex-1 truncate text-left'>退出云端账号</span>
            </button>
          ) : (
            <button
              type='button'
              className={menuItemClass}
              onClick={() => void cloud.login()}
              disabled={cloud.busy}
            >
              <span className={menuIconClass}>
                <People theme='outline' size='16' fill='currentColor' />
              </span>
              <span className='flex-1 truncate text-left'>
                {cloud.busy ? '登录中…' : '登录云端账号'}
              </span>
            </button>
          )}

          {/* Local WebUI logout (only in browser mode) */}
          {showLocalLogout && (
            <>
              <div className='mx-6px my-2px h-1px bg-[var(--color-border-2)]' />
              <div className='px-4px'>
                <button type='button' className={menuItemClass} onClick={handleLogout}>
                  <span className={menuIconClass}>
                    <CloseOne theme='outline' size='16' fill='currentColor' />
                  </span>
                  <span className='flex-1 truncate text-left'>{t('settings.googleLogout')}</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <CssThemeModal
        visible={themeModalVisible}
        theme={editingTheme}
        onClose={closeThemeModal}
        onSave={(data) => void handleThemeSave(data)}
        onDelete={canDeleteTheme ? handleThemeDelete : undefined}
      />
    </div>
  );
};

export default UserMenu;
