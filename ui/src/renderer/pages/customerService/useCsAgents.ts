/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import type { ICsAgent, ICsAgentPatch, ICsNote, ICsWidgetConfig } from '@/common/adapter/ipcBridge';
import type { CsAgentId } from '@/common/types/ids';

/**
 * 客服（Customer Service）花名册 —— 面向陌生访客的客服员工列表 + 创建。
 *
 * 与「数字员工」完全独立：独立数据 / 配置 / 控制台，绝不混入数字员工列表或
 * 会话侧边栏。数据经 `/api/customer-service` REST 契约拉取。
 */
export const useCsAgents = () => {
  const [agents, setAgents] = useState<ICsAgent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setAgents((await ipcBridge.customerService.listAgents.invoke()) ?? []);
    } catch {
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: { name: string } & ICsAgentPatch): Promise<ICsAgent> => {
      const created = await ipcBridge.customerService.createAgent.invoke(input);
      await refresh();
      return created;
    },
    [refresh]
  );

  return { agents, loading, refresh, create };
};

/**
 * 单个客服员工的档案 + 乐观 PATCH 通道。乐观更新本地状态，失败则回读权威值。
 */
export const useCsAgent = (csAgentId: CsAgentId | null) => {
  const [agent, setAgent] = useState<ICsAgent | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!csAgentId) {
      setAgent(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setAgent(await ipcBridge.customerService.getAgent.invoke({ cs_agent_id: csAgentId }));
    } catch {
      setAgent(null);
    } finally {
      setLoading(false);
    }
  }, [csAgentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (p: ICsAgentPatch): Promise<ICsAgent | undefined> => {
      if (!csAgentId) return undefined;
      setAgent((prev) => (prev ? { ...prev, ...p } as ICsAgent : prev));
      try {
        const updated = await ipcBridge.customerService.patchAgent.invoke({
          cs_agent_id: csAgentId,
          patch: p,
        });
        setAgent(updated);
        return updated;
      } catch (e) {
        // Re-sync to the authoritative record so the UI never lies after a failed save.
        await load();
        throw e;
      }
    },
    [csAgentId, load]
  );

  return { agent, loading, reload: load, patch };
};

/**
 * Notes visible to one agent (private + shared). The workbench uses this to
 * surface "kind=script" notes as one-click quick replies.
 */
export const useCsNotes = (csAgentId: CsAgentId | null) => {
  const [notes, setNotes] = useState<ICsNote[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!csAgentId) {
      setNotes([]);
      return;
    }
    setLoading(true);
    try {
      const list = await ipcBridge.customerService.listNotes.invoke({
        cs_agent_id: csAgentId,
      });
      setNotes(list);
    } catch {
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [csAgentId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { notes, loading, reload: load };
};

/**
 * Web-widget configuration of one agent (5.0.31).
 *
 * Starts as `null` until the first read resolves so the UI can distinguish
 * "still loading" from "widget disabled".
 */
export const useCsWidgetConfig = (csAgentId: CsAgentId | null) => {
  const [config, setConfig] = useState<ICsWidgetConfig | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!csAgentId) {
      setConfig(null);
      return;
    }
    setLoading(true);
    try {
      setConfig(await ipcBridge.customerService.getWidgetConfig.invoke({ cs_agent_id: csAgentId }));
    } catch {
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, [csAgentId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Apply a partial update and return the new config (or `null` on failure). */
  const update = useCallback(
    async (patch: {
      enabled?: boolean;
      rotate_key?: boolean;
      allowed_origins?: string[];
      theme?: Record<string, unknown>;
    }) => {
      if (!csAgentId) return null;
      setLoading(true);
      try {
        const next = await ipcBridge.customerService.putWidgetConfig.invoke({
          cs_agent_id: csAgentId,
          ...patch,
        });
        setConfig(next);
        return next;
      } catch {
        // Keep the previous config on failure so the UI stays consistent with
        // the server rather than showing a state that was never persisted.
        return null;
      } finally {
        setLoading(false);
      }
    },
    [csAgentId]
  );

  return { config, loading, reload: load, update };
};
