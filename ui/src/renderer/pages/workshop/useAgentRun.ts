/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runner engine for the independent agent page (`/workshop/agent/:id`).
 *
 * Reuses the same backend the canvas generator card talks to — it mints a
 * backing canvas + doc, submits `POST /api/creation/tasks`, and polls to a
 * terminal state — but exposes a flat form-driven API instead of the node
 * canvas. No new backend endpoints are required.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelTask as apiCancelTask,
  createCanvas,
  createTask,
  getTask,
  putCanvasDoc,
  uploadAsset,
} from './api';
import { buildAgentDoc, deriveCapability, type MarketAgent } from './agents';
import { buildTaskParams } from './generation/genConstants';
import type { GenMode, ModelOption } from './generation/genTypes';
import { generationModeForTask } from './generation/useGenerationRun';
import { succeededArtifactIds } from './generation/taskArtifacts';
import { useGeneratorModels } from './generation/useGeneratorModels';
import type {
  AssetId,
  CanvasId,
  CreationTaskId,
  ProviderId,
  WorkshopNodeId,
} from '@/common/types/ids';
import type { CreationTask } from './types';

export type AgentRunStatus =
  | 'idle'
  | 'uploading'
  | 'submitting'
  | 'queued'
  | 'running'
  | 'success'
  | 'error'
  | 'canceled';

export interface AgentRunState {
  status: AgentRunStatus;
  /** Upload percentage (0–100) while `status === 'uploading'`. */
  progress?: number;
  resultAssets: AssetId[];
  resultMode: GenMode | null;
  error?: string;
  taskId?: CreationTaskId;
  canvasId?: CanvasId;
}

const POLL_INTERVAL_MS = 2000;

function mapStatus(s: CreationTask['status']): AgentRunStatus {
  switch (s) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'running';
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'error';
    case 'canceled':
    default:
      return 'canceled';
  }
}

export interface UseAgentRun {
  state: AgentRunState;
  hasModel: boolean;
  model: ModelOption | null;
  run: (values: Record<string, string>, file?: File) => Promise<void>;
  cancel: () => void;
}

export function useAgentRun(agent: MarketAgent): UseAgentRun {
  const models = useGeneratorModels(agent.mode);
  const model = models.flat[0] ?? null;
  const [state, setState] = useState<AgentRunState>({
    status: 'idle',
    resultAssets: [],
    resultMode: null,
  });

  const mountedRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const activeTaskRef = useRef<CreationTaskId | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const finalize = useCallback(
    (task: CreationTask, canvasId: CanvasId, ok: boolean) => {
      activeTaskRef.current = null;
      clearTimer();
      if (ok) {
        const ids = succeededArtifactIds(task);
        if (!ids) {
          setState({
            status: 'error',
            error: '生成完成，但没有返回可用的素材。',
            resultAssets: [],
            resultMode: null,
            taskId: task.creation_task_id,
            canvasId,
          });
          return;
        }
        setState({
          status: 'success',
          resultAssets: ids,
          resultMode: generationModeForTask(task),
          taskId: task.creation_task_id,
          canvasId,
        });
      } else {
        setState({
          status: 'error',
          error: task.error?.message || '生成失败',
          resultAssets: [],
          resultMode: null,
          taskId: task.creation_task_id,
          canvasId,
        });
      }
    },
    [clearTimer]
  );

  const poll = useCallback(
    (taskId: CreationTaskId, canvasId: CanvasId) => {
      const tick = (): void => {
        if (!mountedRef.current || activeTaskRef.current !== taskId) return;
        getTask(taskId)
          .then((task) => {
            if (!mountedRef.current || activeTaskRef.current !== taskId) return;
            if (task.status === 'succeeded') {
              finalize(task, canvasId, true);
              return;
            }
            if (task.status === 'failed' || task.status === 'canceled') {
              finalize(task, canvasId, false);
              return;
            }
            setState((s) => ({ ...s, status: mapStatus(task.status) }));
            timerRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
          })
          .catch(() => {
            if (!mountedRef.current || activeTaskRef.current !== taskId) return;
            timerRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
          });
      };
      tick();
    },
    [finalize]
  );

  const run = useCallback(
    async (values: Record<string, string>, file?: File) => {
      const model = models.flat[0];
      if (!model) {
        setState((s) => ({ ...s, status: 'error', error: '请先在模型中心配置可用的生成模型。' }));
        return;
      }
      clearTimer();
      activeTaskRef.current = null;

      let refAssetId: AssetId | null = null;
      if (file) {
        setState((s) => ({ ...s, status: 'uploading', progress: 0, resultAssets: [], resultMode: null, error: undefined }));
        try {
          const asset = await uploadAsset(file, {
            onProgress: (p) => setState((s) => ({ ...s, progress: p })),
          });
          refAssetId = asset.asset_id;
        } catch (e) {
          setState((s) => ({ ...s, status: 'error', error: e instanceof Error ? e.message : '上传失败' }));
          return;
        }
      } else {
        setState((s) => ({ ...s, status: 'submitting', resultAssets: [], resultMode: null, error: undefined }));
      }

      try {
        const prompt = agent.buildPrompt(values);
        const canvas = await createCanvas({ title: agent.title });
        const { doc, generatorNodeId } = buildAgentDoc(agent, prompt, refAssetId);
        await putCanvasDoc(canvas.canvas_id, doc);

        const capability = deriveCapability(agent.mode, !!refAssetId);
        const params = buildTaskParams(agent.mode, agent.defaultParams, prompt);
        const inputs = refAssetId ? [{ asset_id: refAssetId, role: 'reference' as const }] : [];

        const task = await createTask({
          canvas_id: canvas.canvas_id,
          node_id: generatorNodeId as WorkshopNodeId,
          provider_id: model.providerId as ProviderId,
          model: model.model,
          capability,
          params,
          inputs,
        });

        activeTaskRef.current = task.creation_task_id;
        setState((s) => ({
          ...s,
          status: mapStatus(task.status),
          taskId: task.creation_task_id,
          canvasId: canvas.canvas_id,
        }));
        if (task.status === 'succeeded') {
          finalize(task, canvas.canvas_id, true);
        } else if (task.status === 'failed' || task.status === 'canceled') {
          finalize(task, canvas.canvas_id, false);
        } else {
          poll(task.creation_task_id, canvas.canvas_id);
        }
      } catch (e) {
        setState((s) => ({ ...s, status: 'error', error: e instanceof Error ? e.message : '提交失败' }));
      }
    },
    [agent, models.flat, clearTimer, finalize, poll]
  );

  const cancel = useCallback(() => {
    const taskId = activeTaskRef.current;
    clearTimer();
    activeTaskRef.current = null;
    setState((s) => ({ ...s, status: 'canceled', taskId: taskId ?? s.taskId }));
    if (taskId) void apiCancelTask(taskId).catch(() => {});
  }, [clearTimer]);

  return { state, hasModel: models.flat.length > 0, model, run, cancel };
}
