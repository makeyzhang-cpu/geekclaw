/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cloud account OAuth client (desktop side).
 *
 * Flow: `openCloudLogin()` launches the SYSTEM browser at our local
 * `/api/oauth/geekclaw/start`, which 302s to the cloud login page with
 * `redirect_uri=geekclaw://auth/callback`. After the user logs in, the cloud
 * redirects to that deep link; `subscribeCloudAuth()` captures it and calls
 * `/api/oauth/geekclaw/exchange`, which redeems the code for a JWT server-side
 * (the token never enters the browser). The UI then polls `/api/auth/cloud-status`.
 */

import { httpRequest } from '@/common/adapter/httpBridge';
import { subscribeDeepLink } from '@/common/adapter/tauriShell';
import { isTauriRuntime } from '@/common/adapter/tauriRuntime';

export interface CloudUser {
  sub?: string;
  name?: string;
  email?: string;
  username?: string;
}

export interface CloudAuthState {
  authenticated: boolean;
  user?: CloudUser | null;
}

export interface CloudAuthResult {
  success: boolean;
  error?: string;
}

const DEEP_LINK_ACTION = 'auth';

function localBase(): string {
  const port = (window as unknown as { __backendPort?: number }).__backendPort ?? 13400;
  return `http://127.0.0.1:${port}`;
}

/** Open the SYSTEM browser to the cloud login page (via our local OAuth start route). */
export async function openCloudLogin(): Promise<void> {
  const url = `${localBase()}/api/oauth/geekclaw/start`;
  if (isTauriRuntime()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

/** Read the current cloud auth state from the local backend. */
export async function getCloudAuthState(): Promise<CloudAuthState> {
  try {
    const res = await httpRequest<CloudAuthState>('GET', '/api/auth/cloud-status');
    if (res && typeof res === 'object' && 'authenticated' in res) {
      return res;
    }
  } catch {
    /* backend unreachable or route not yet wired */
  }
  return { authenticated: false };
}

/** Poll until the cloud token is stored locally (after the deep link returns). */
export async function waitForCloudAuth(timeoutMs = 60000): Promise<CloudAuthState> {
  const deadline = Date.now() + timeoutMs;
  // Small initial delay so the deep link has time to round-trip.
  await new Promise((r) => setTimeout(r, 800));
  while (Date.now() < deadline) {
    const st = await getCloudAuthState();
    if (st.authenticated) return st;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { authenticated: false };
}

/** Feed a captured `geekclaw://auth/callback` deep link into the local exchange endpoint. */
export async function handleCloudDeepLink(params: Record<string, string>): Promise<CloudAuthState> {
  const code = params['code'];
  const token = params['token'];
  const state = params['state'];
  const error = params['error'];
  // Cloud rejected/aborted the authorization (e.g. OAuth `error=access_denied`).
  if (error) {
    return { authenticated: false };
  }
  if (code || token) {
    try {
      await httpRequest<CloudAuthResult>(
        'POST',
        '/api/oauth/geekclaw/exchange',
        // Forward `state` so the backend can run its CSRF check against the `/start` value
        // for BOTH the code flow and the implicit token flow.
        code ? { code, state } : { token, state }
      );
    } catch {
      /* ignore network errors; the status poll reflects reality */
    }
  }
  return getCloudAuthState();
}

/** Subscribe to `geekclaw://auth` deep links; invokes `onAuth` once the cloud returns. */
export async function subscribeCloudAuth(
  onAuth: (state: CloudAuthState) => void
): Promise<() => void> {
  return subscribeDeepLink(async (payload) => {
    if (payload.action !== DEEP_LINK_ACTION) return;
    const state = await handleCloudDeepLink(payload.params);
    onAuth(state);
  });
}

/** Drop the locally stored cloud token. */
export async function cloudLogout(): Promise<void> {
  try {
    await httpRequest<CloudAuthResult>('POST', '/api/auth/cloud-logout');
  } catch {
    /* ignore */
  }
}
