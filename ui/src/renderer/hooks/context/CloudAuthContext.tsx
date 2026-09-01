/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Global cloud-account auth state for the desktop shell.
 *
 * The desktop backend persists the cloud JWT in a local KV entry
 * (`cloud_auth_token`); this provider loads it on startup via
 * `GET /api/auth/cloud-status` and exposes a single source of truth so the
 * login wall, the user menu, and the pricing page all stay in sync.
 *
 * On the WebUI (non-desktop) build cloud auth is irrelevant — the provider
 * stays in a ready/no-op state and the existing local session auth gates the
 * app instead.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isDesktopShell } from '@renderer/utils/platform';
import {
  cloudLogout,
  getCloudAuthState,
  openCloudLogin,
  subscribeCloudAuth,
  waitForCloudAuth,
  type CloudAuthState,
} from '@/common/adapter/cloudAuth';

const isDesktop = isDesktopShell();

interface CloudAuthContextValue {
  /** Initial cloud-status load finished (always true on non-desktop). */
  ready: boolean;
  /** Persisted cloud auth state. */
  state: CloudAuthState;
  /** A cloud login flow is in progress (browser open + waiting for callback). */
  busy: boolean;
  /** Open the system browser to the cloud login page and wait for the callback. */
  login: () => Promise<void>;
  /** Drop the locally stored cloud token. */
  logout: () => Promise<void>;
  /** Re-read the persisted cloud state from the backend. */
  refresh: () => Promise<void>;
}

const CloudAuthContext = createContext<CloudAuthContextValue | undefined>(undefined);

export const CloudAuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [ready, setReady] = useState(!isDesktop);
  const [state, setState] = useState<CloudAuthState>({ authenticated: false });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!isDesktop) {
      setReady(true);
      return;
    }
    const st = await getCloudAuthState();
    setState(st);
    setReady(true);
  }, []);

  const login = useCallback(async () => {
    if (!isDesktop || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await openCloudLogin();
      const st = await waitForCloudAuth(90000);
      setState(st);
    } catch (error) {
      console.error('[cloud-auth] login failed:', error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const logout = useCallback(async () => {
    if (!isDesktop) return;
    try {
      await cloudLogout();
    } catch (error) {
      console.error('[cloud-auth] logout failed:', error);
    }
    setState({ authenticated: false });
  }, []);

  useEffect(() => {
    if (!isDesktop) return undefined;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    void subscribeCloudAuth((st) => {
      if (disposed) return;
      setState(st);
      busyRef.current = false;
      setBusy(false);
    }).then((fn) => {
      if (disposed) fn();
      else unsubscribe = fn;
    });

    void refresh();

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [refresh]);

  const value = useMemo<CloudAuthContextValue>(
    () => ({ ready, state, busy, login, logout, refresh }),
    [ready, state, busy, login, logout, refresh]
  );

  return <CloudAuthContext.Provider value={value}>{children}</CloudAuthContext.Provider>;
};

export function useCloudAuth(): CloudAuthContextValue {
  const context = useContext(CloudAuthContext);
  if (!context) {
    throw new Error('useCloudAuth must be used within a CloudAuthProvider');
  }
  return context;
}
