/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WorkshopAgentRunnerPage (`/workshop/agent/:agentId`) — the 方案B app-market
 * runner. A form-driven, node-canvas-free generation surface: the user fills the
 * agent's inputs, hits 生成, and sees the result inline (image / video / audio /
 * text). A backing canvas is minted behind the scenes so the run is fully
 * compatible with the existing creation pipeline and can later be opened in the
 * full editor.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Spin } from '@arco-design/web-react';
import {
  ArrowLeft,
  CloseSmall,
  Creative,
  Loading,
  Picture,
  Refresh,
  Upload,
  VideoTwo,
  User,
  MagicWand,
  Edit,
  Movie,
} from '@icon-park/react';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { useArcoMessage } from '@renderer/utils/ui/useArcoMessage';
import { workshopFileUrl } from './api';
import { loadWorkshopText } from './generation/pipeline';
import { getAgentById, type AgentField, type MarketAgent } from './agents';
import { useAgentRun } from './useAgentRun';
import type { AssetId } from '@/common/types/ids';

const ICONS: Record<string, typeof Picture> = {
  Picture,
  VideoTwo,
  User,
  MagicWand,
  Edit,
  Creative,
  Movie,
};

/** Resolve a field's effective value (text/select) from form state. */
function fieldValue(values: Record<string, string>, f: AgentField): string {
  return values[f.key] ?? f.defaultValue ?? '';
}

// ─── Agent not found ──────────────────────────────────────────────────────────

const AgentNotFound: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <div className='size-full grid place-items-center box-border p-24px'>
      <div className='flex flex-col items-center gap-12px text-center'>
        <span className='text-15px font-600 text-[var(--color-text-1)]'>
          {t('workshop.runner.notFound', { defaultValue: '未找到该智能体' })}
        </span>
        <Button type='primary' onClick={() => navigate('/workshop')}>
          {t('workshop.runner.backToMarket', { defaultValue: '返回创意工坊' })}
        </Button>
      </div>
    </div>
  );
};

// ─── Image dropzone ───────────────────────────────────────────────────────────

interface ImageFieldProps {
  value: File | null;
  onChange: (file: File | null) => void;
}

const ImageDropzone: React.FC<ImageFieldProps> = ({ value, onChange }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (value) {
      const url = URL.createObjectURL(value);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreview(null);
  }, [value]);

  return (
    <div
      className={[
        'relative flex flex-col items-center justify-center gap-8px rounded-12px border border-dashed',
        'border-[var(--color-border-3)] bg-[var(--color-fill-2)] px-12px py-18px cursor-pointer',
        'hover:border-[var(--color-primary-light-3)] transition-colors',
      ].join(' ')}
      onClick={() => inputRef.current?.click()}
    >
      {preview ? (
        <>
          <img src={preview} alt='preview' className='max-h-160px rounded-8px object-contain' />
          <button
            type='button'
            className='absolute right-8px top-8px grid h-24px w-24px place-items-center rounded-full bg-[rgba(0,0,0,0.5)] text-white'
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
          >
            <CloseSmall theme='outline' size={14} />
          </button>
        </>
      ) : (
        <>
          <Upload theme='outline' size={26} className='text-[var(--color-text-3)]' />
          <span className='text-12px text-[var(--color-text-3)]'>点击上传图片</span>
        </>
      )}
      <input
        ref={inputRef}
        type='file'
        accept='image/*'
        className='hidden'
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          onChange(f);
          e.target.value = '';
        }}
      />
    </div>
  );
};

// ─── Result panel ─────────────────────────────────────────────────────────────

interface ResultPanelProps {
  agent: MarketAgent;
  state: ReturnType<typeof useAgentRun>['state'];
  textContent: string | null;
  onOpenCanvas: (canvasId: string) => void;
  onRegenerate: () => void;
  onCancel: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中…',
  running: '生成中…',
  uploading: '上传中…',
  submitting: '提交中…',
};

const ResultPanel: React.FC<ResultPanelProps> = ({
  agent,
  state,
  textContent,
  onOpenCanvas,
  onRegenerate,
  onCancel,
}) => {
  const { t } = useTranslation();

  if (state.status === 'idle') {
    return (
      <div className='flex h-full min-h-300px flex-col items-center justify-center gap-10px text-center text-[var(--color-text-3)]'>
        <Creative theme='outline' size={32} />
        <span className='text-13px'>
          {t('workshop.runner.resultPlaceholder', { defaultValue: '在左侧填写信息，点击「生成」即可开始创作。' })}
        </span>
      </div>
    );
  }

  if (state.status === 'uploading' || state.status === 'submitting' || state.status === 'queued' || state.status === 'running') {
    return (
      <div className='flex h-full min-h-300px flex-col items-center justify-center gap-14px'>
        <Loading theme='outline' size={30} className='animate-spin text-primary-6' />
        <span className='text-13px text-[var(--color-text-2)]'>
          {STATUS_LABEL[state.status] ?? '处理中…'}
          {state.status === 'uploading' && typeof state.progress === 'number'
            ? ` ${state.progress}%`
            : ''}
        </span>
        <Button size='small' onClick={onCancel}>
          {t('workshop.runner.cancel', { defaultValue: '取消' })}
        </Button>
      </div>
    );
  }

  if (state.status === 'error' || state.status === 'canceled') {
    return (
      <div className='flex h-full min-h-300px flex-col items-center justify-center gap-12px text-center'>
        <span className='text-14px font-600 text-[var(--color-text-1)]'>
          {state.status === 'canceled'
            ? t('workshop.runner.canceled', { defaultValue: '已取消' })
            : t('workshop.runner.failed', { defaultValue: '生成失败' })}
        </span>
        {state.error && <span className='max-w-320px text-12px text-[var(--color-text-3)]'>{state.error}</span>}
        <Button type='primary' size='small' onClick={onRegenerate}>
          {t('workshop.runner.retry', { defaultValue: '重试' })}
        </Button>
      </div>
    );
  }

  // success
  const mode = state.resultMode;
  return (
    <div className='flex flex-col gap-12px'>
      {state.resultAssets.map((assetId: AssetId, i) => {
        const url = workshopFileUrl(assetId);
        if (mode === 'video') {
          return (
            <video key={assetId} src={url} controls className='w-full rounded-12px bg-black' />
          );
        }
        if (mode === 'tts') {
          return <audio key={assetId} src={url} controls className='w-full' />;
        }
        if (mode === 'text') {
          return (
            <pre
              key={assetId}
              className='m-0 max-h-420px overflow-auto whitespace-pre-wrap rounded-12px bg-[var(--color-fill-2)] p-14px text-13px leading-20px text-[var(--color-text-1)]'
            >
              {textContent ?? t('workshop.runner.loadingText', { defaultValue: '加载中…' })}
            </pre>
          );
        }
        // image
        return (
          <img
            key={assetId}
            src={url}
            alt={`result-${i}`}
            className='w-full rounded-12px object-contain'
            loading='lazy'
          />
        );
      })}

      <div className='flex items-center gap-8px'>
        {state.canvasId && (
          <Button
            type='primary'
            size='small'
            icon={<Creative theme='outline' size={14} />}
            onClick={() => onOpenCanvas(state.canvasId as string)}
          >
            {t('workshop.runner.openInCanvas', { defaultValue: '在画布中打开' })}
          </Button>
        )}
        <Button size='small' icon={<Refresh theme='outline' size={14} />} onClick={onRegenerate}>
          {t('workshop.runner.regenerate', { defaultValue: '重新生成' })}
        </Button>
      </div>
    </div>
  );
};

// ─── Inner runner (agent resolved) ────────────────────────────────────────────

const AgentRunnerInner: React.FC<{ agent: MarketAgent }> = ({ agent }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [message, messageHolder] = useArcoMessage();

  const { state, hasModel, run, cancel } = useAgentRun(agent);

  const [values, setValues] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);

  const imageField = useMemo(() => agent.fields.find((f) => f.kind === 'image') ?? null, [agent.fields]);

  // Reset transient result text whenever a fresh run starts.
  useEffect(() => {
    if (state.status === 'idle' || state.status === 'submitting' || state.status === 'uploading') {
      setTextContent(null);
    }
  }, [state.status]);

  // Fetch text result body for text-mode agents.
  useEffect(() => {
    if (state.status === 'success' && state.resultMode === 'text' && state.resultAssets[0]) {
      let alive = true;
      void loadWorkshopText(state.resultAssets[0]).then((txt) => {
        if (alive) setTextContent(txt);
      });
      return () => {
        alive = false;
      };
    }
  }, [state.status, state.resultMode, state.resultAssets]);

  const validateAndRun = useCallback(async () => {
    if (!hasModel) {
      message.error(t('workshop.runner.noModel', { defaultValue: '请先在模型中心配置可用的生成模型。' }));
      return;
    }
    for (const f of agent.fields) {
      if (f.required) {
        if (f.kind === 'image') {
          if (!file) {
            message.error(`${t('workshop.runner.pleaseFill', { defaultValue: '请填写' })}${f.label}`);
            return;
          }
        } else if (!fieldValue(values, f).trim()) {
          message.error(`${t('workshop.runner.pleaseFill', { defaultValue: '请填写' })}${f.label}`);
          return;
        }
      }
    }
    await run(values, file ?? undefined);
  }, [agent.fields, file, hasModel, message, run, t, values]);

  const IconC = ICONS[agent.icon] ?? Creative;

  return (
    <div className='size-full box-border overflow-y-auto'>
      {messageHolder}
      <div className='mx-auto flex w-full max-w-1180px box-border flex-col gap-16px px-12px py-20px md:px-32px md:py-28px'>
        {/* Header */}
        <div className='flex items-center gap-12px'>
          <button
            type='button'
            onClick={() => navigate('/workshop')}
            className='grid h-32px w-32px shrink-0 place-items-center rounded-9px border border-solid border-[var(--color-border-3)] text-[var(--color-text-2)] hover:text-primary-6 hover:border-[var(--color-primary-light-3)] transition-colors'
            title={t('workshop.runner.back', { defaultValue: '返回' })}
          >
            <ArrowLeft theme='outline' size={16} />
          </button>
          <span
            className='grid h-36px w-36px shrink-0 place-items-center rounded-10px'
            style={{ background: `color-mix(in srgb, ${agent.accent} 15%, transparent)`, color: agent.accent }}
          >
            <IconC theme='outline' size={20} fill='currentColor' />
          </span>
          <div className='min-w-0'>
            <div className='flex items-center gap-8px'>
              <h1 className='m-0 truncate text-17px font-700 leading-tight text-[var(--color-text-1)]'>
                {agent.title}
              </h1>
              <span className='shrink-0 rounded-full px-8px py-2px text-11px font-600' style={{ background: `color-mix(in srgb, ${agent.accent} 14%, transparent)`, color: agent.accent }}>
                {agent.scene}
              </span>
            </div>
            <p className='m-0 truncate text-12px text-[var(--color-text-3)]'>{agent.desc}</p>
          </div>
        </div>

        {!hasModel && (
          <Alert
            type='warning'
            showIcon
            content={t('workshop.runner.noModelHint', { defaultValue: '尚未配置可用的生成模型，请先到模型中心添加并启用一个图像/视频/语音模型。' })}
          />
        )}

        {/* Body: form + result */}
        <div className={isMobile ? 'flex flex-col gap-16px' : 'flex items-start gap-20px'}>
          {/* Form */}
          <div className='flex w-full flex-col gap-14px rounded-16px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-18px md:w-380px md:shrink-0'>
            {agent.fields.map((f) => {
              if (f.kind === 'image') {
                return (
                  <div key={f.key} className='flex flex-col gap-6px'>
                    <label className='text-13px font-600 text-[var(--color-text-1)]'>
                      {f.label}
                      {f.required && <span className='ml-2px text-danger-6'>*</span>}
                    </label>
                    <ImageDropzone value={file} onChange={setFile} />
                  </div>
                );
              }
              if (f.kind === 'select') {
                return (
                  <div key={f.key} className='flex flex-col gap-6px'>
                    <label className='text-13px font-600 text-[var(--color-text-1)]'>
                      {f.label}
                      {f.required && <span className='ml-2px text-danger-6'>*</span>}
                    </label>
                    <select
                      className='w-full rounded-9px border border-solid border-[var(--color-border-3)] bg-[var(--color-bg-1)] px-10px py-8px text-13px text-[var(--color-text-1)] outline-none focus:border-primary-6'
                      value={fieldValue(values, f)}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    >
                      {(f.options ?? []).map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }
              // text
              return (
                <div key={f.key} className='flex flex-col gap-6px'>
                  <label className='text-13px font-600 text-[var(--color-text-1)]'>
                    {f.label}
                    {f.required && <span className='ml-2px text-danger-6'>*</span>}
                  </label>
                  <textarea
                    className='min-h-88px w-full resize-y rounded-9px border border-solid border-[var(--color-border-3)] bg-[var(--color-bg-1)] px-10px py-8px text-13px leading-19px text-[var(--color-text-1)] outline-none focus:border-primary-6'
                    placeholder={f.placeholder}
                    value={fieldValue(values, f)}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                </div>
              );
            })}

            <Button
              type='primary'
              long
              loading={state.status === 'uploading' || state.status === 'submitting' || state.status === 'queued' || state.status === 'running'}
              onClick={() => void validateAndRun()}
              className='mt-4px'
            >
              <span className='inline-flex items-center gap-6px'>
                <Creative theme='outline' size={15} fill='currentColor' />
                {t('workshop.runner.generate', { defaultValue: '生成' })}
              </span>
            </Button>
          </div>

          {/* Result */}
          <div className='w-full flex-1 rounded-16px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-18px'>
            <ResultPanel
              agent={agent}
              state={state}
              textContent={textContent}
              onOpenCanvas={(canvasId) => navigate(`/workshop/${canvasId}`)}
              onRegenerate={() => void validateAndRun()}
              onCancel={cancel}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Top-level page (resolves the agent id) ───────────────────────────────────

const WorkshopAgentRunnerPage: React.FC = () => {
  const { agentId } = useParams<{ agentId: string }>();
  const agent = agentId ? getAgentById(agentId) : undefined;
  if (!agent) return <AgentNotFound />;
  return <AgentRunnerInner agent={agent} />;
};

export default WorkshopAgentRunnerPage;
