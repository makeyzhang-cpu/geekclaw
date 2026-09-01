import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { httpRequest } from '@/common/adapter/httpBridge';

export interface LicenseStatus {
  active: boolean;
  edition: string | null;
  features: string[];
  expires_at: number | null;
  activated_at: number | null;
}

interface ActivateResult {
  success: boolean;
  message: string;
}

interface LicenseContextValue {
  ready: boolean;
  active: boolean;
  edition: string | null;
  features: string[];
  expiresAt: number | null;
  activatedAt: number | null;
  /** True when the given feature (or any Pro feature) is unlocked. */
  hasFeature: (feature?: string) => boolean;
  activate: (key: string) => Promise<ActivateResult>;
  deactivate: () => Promise<void>;
  refresh: () => Promise<void>;
}

const EMPTY: LicenseStatus = {
  active: false,
  edition: null,
  features: [],
  expires_at: null,
  activated_at: null,
};

const LicenseContext = createContext<LicenseContextValue | undefined>(undefined);

async function fetchStatus(): Promise<LicenseStatus> {
  try {
    const data = await httpRequest<LicenseStatus>('GET', '/api/license/status', undefined, {
      silentStatuses: [403, 401],
    });
    if (data && typeof data.active === 'boolean') return data;
    return EMPTY;
  } catch {
    return EMPTY;
  }
}

export const LicenseProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [status, setStatus] = useState<LicenseStatus>(EMPTY);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const s = await fetchStatus();
    setStatus(s);
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activate = useCallback(async (key: string): Promise<ActivateResult> => {
    try {
      const data = await httpRequest<{ success: boolean; message: string; status: LicenseStatus }>(
        'POST',
        '/api/license/activate',
        { key }
      );
      setStatus(data.status);
      return { success: data.success, message: data.message };
    } catch (error) {
      const msg =
        (error as { code?: string; message?: string })?.code ??
        (error as { code?: string; message?: string })?.message ??
        'activate_failed';
      return { success: false, message: msg };
    }
  }, []);

  const deactivate = useCallback(async () => {
    try {
      await httpRequest('POST', '/api/license/deactivate');
    } catch {
      // ignore — refresh covers it
    } finally {
      await refresh();
    }
  }, [refresh]);

  const hasFeature = useCallback(
    (feature?: string): boolean => {
      if (!status.active) return false;
      if (!feature) return true;
      return status.features.includes(feature);
    },
    [status]
  );

  const value = useMemo<LicenseContextValue>(
    () => ({
      ready,
      active: status.active,
      edition: status.edition,
      features: status.features,
      expiresAt: status.expires_at,
      activatedAt: status.activated_at,
      hasFeature,
      activate,
      deactivate,
      refresh,
    }),
    [ready, status, hasFeature, activate, deactivate, refresh]
  );

  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>;
};

export function useLicense(): LicenseContextValue {
  const ctx = useContext(LicenseContext);
  if (!ctx) {
    throw new Error('useLicense must be used within LicenseProvider');
  }
  return ctx;
}
