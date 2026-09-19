/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI 短视频工坊 — embedded MoneyPrinterTurbo engine (MIT) front-end.
 * Talks to the trusted local backend at /api/video-studio/* (proxied to the
 * engine sidecar); media previews use the auth-exempt /video-studio-public/*.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBaseUrl, buildBackendAuthHeaders } from '@/common/adapter/httpBridge';

interface EngineStatus {
  engine: 'up' | 'down';
  llm_configured: boolean;
  llm_provider?: string | null;
}

interface TaskItem {
  task_id: string;
  state?: string;
  videos?: string[];
  [key: string]: unknown;
}

const ASPECTS = ['9:16', '16:9', '1:1'] as const;
const VOICES = [
  'zh-CN-XiaoxiaoNeural-Female',
  'zh-CN-YunxiNeural-Male',
  'zh-CN-YunyangNeural-Male',
  'en-US-JennyNeural-Female',
];

function videoSrc(task: TaskItem): string | null {
  const raw = task?.videos?.[0];
  if (!raw || typeof raw !== 'string') return null;
  let p = raw.startsWith('/tasks/') ? raw.slice('/tasks/'.length) : raw;
  if (p.startsWith('/')) p = p.slice(1);
  return `${getBaseUrl()}/video-studio-public/stream/${encodeURIComponent(p)}`;
}

function VideoStudioPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [subject, setSubject] = useState('');
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]>('9:16');
  const [voice, setVoice] = useState(VOICES[0]);
  const [subtitle, setSubtitle] = useState(true);
  const [bgm, setBgm] = useState('random');
  const [count, setCount] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState('');
  const pollRef = useRef<number | null>(null);

  const api = useCallback(async (path: string, method = 'GET', body?: unknown) => {
    const headers = buildBackendAuthHeaders(method);
    const res = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : null;
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api('/api/video-studio/status');
      setStatus(s);
    } catch {
      setStatus({ engine: 'down', llm_configured: false });
    }
  }, [api]);

  const refreshTasks = useCallback(async () => {
    try {
      const data = await api('/api/video-studio/tasks?page=1&page_size=20');
      setTasks(data?.tasks ?? []);
    } catch {
      /* ignore */
    }
  }, [api]);

  const anyPending = tasks.some((tk) => tk.state !== 'completed' && tk.state !== 'failed');

  useEffect(() => {
    refreshStatus();
    refreshTasks();
  }, [refreshStatus, refreshTasks]);

  useEffect(() => {
    if (generating || anyPending) {
      pollRef.current = window.setInterval(() => {
        refreshTasks();
        refreshStatus();
      }, 3000);
      return () => {
        if (pollRef.current) window.clearInterval(pollRef.current);
      };
    }
    return undefined;
  }, [generating, anyPending, refreshTasks, refreshStatus]);

  const handleGenerate = async () => {
    if (!subject.trim()) {
      setMessage(t('videoStudio.form.subject') + '?');
      return;
    }
    setGenerating(true);
    setMessage('');
    try {
      await api('/api/video-studio/videos', 'POST', {
        video_subject: subject.trim(),
        video_aspect: aspect,
        voice_name: voice,
        subtitle_enabled: subtitle,
        bgm_type: bgm,
        video_count: count,
      });
      await refreshTasks();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleConfig = async (provider: string, apiKey: string, baseUrl: string, model: string) => {
    try {
      await api('/api/video-studio/llm-config', 'POST', {
        provider,
        api_key: apiKey,
        base_url: baseUrl || undefined,
        model_name: model || undefined,
      });
      setMessage(t('videoStudio.page.configure') + ' ✓');
      await refreshStatus();
    } catch (e) {
      setMessage(String(e));
    }
  };

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '24px 20px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>
        {t('videoStudio.page.title')}
      </h1>
      <p style={{ color: 'var(--color-text-3)', marginBottom: 16 }}>
        {t('videoStudio.page.desc')}
      </p>

      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          fontSize: 13,
          marginBottom: 16,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: status?.engine === 'up' ? '#00b42a' : '#f53f3f',
          }}
        />
        <span>
          {status?.engine === 'up'
            ? t('videoStudio.page.statusUp')
            : t('videoStudio.page.statusDown')}
        </span>
        {status && !status.llm_configured && (
          <span style={{ color: '#ff7d00' }}>{t('videoStudio.page.llmNotConfigured')}</span>
        )}
      </div>

      {status && !status.llm_configured && (
        <LlmConfigForm onSubmit={handleConfig} />
      )}

      <section
        style={{
          border: '1px solid var(--color-border-2)',
          borderRadius: 12,
          padding: 16,
          marginBottom: 20,
        }}
      >
        <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
          {t('videoStudio.form.subject')}
        </label>
        <textarea
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={t('videoStudio.form.subjectPlaceholder')}
          rows={3}
          style={{ width: '100%', padding: 8, borderRadius: 8, resize: 'vertical' }}
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
          <Field label={t('videoStudio.form.aspect')}>
            <select value={aspect} onChange={(e) => setAspect(e.target.value as never)}>
              {ASPECTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('videoStudio.form.voice')}>
            <select value={voice} onChange={(e) => setVoice(e.target.value)}>
              {VOICES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('videoStudio.form.bgm')}>
            <select value={bgm} onChange={(e) => setBgm(e.target.value)}>
              <option value='random'>random</option>
              <option value='false'>off</option>
            </select>
          </Field>
          <Field label={t('videoStudio.form.count')}>
            <input
              type='number'
              min={1}
              max={5}
              value={count}
              onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
              style={{ width: 64 }}
            />
          </Field>
          <Field label={t('videoStudio.form.subtitle')}>
            <input
              type='checkbox'
              checked={subtitle}
              onChange={(e) => setSubtitle(e.target.checked)}
            />
          </Field>
        </div>

        <button
          onClick={handleGenerate}
          disabled={generating}
          style={{
            marginTop: 16,
            padding: '8px 18px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--primary-6)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          {generating ? t('videoStudio.form.generating') : t('videoStudio.form.generate')}
        </button>
        {message && (
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--color-text-3)' }}>
            {message}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>
          {t('videoStudio.tasks.title')}
        </h2>
        {tasks.length === 0 ? (
          <p style={{ color: 'var(--color-text-3)', fontSize: 13 }}>
            {t('videoStudio.tasks.empty')}
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {tasks.map((tk) => {
              const src = videoSrc(tk);
              return (
                <div
                  key={tk.task_id}
                  style={{
                    border: '1px solid var(--color-border-2)',
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <div style={{ fontSize: 12, color: 'var(--color-text-3)', marginBottom: 6 }}>
                    {tk.task_id} · {tk.state}
                  </div>
                  {src ? (
                    <video src={src} controls style={{ width: '100%', borderRadius: 8 }} />
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--color-text-3)' }}>
                      {tk.state === 'completed' ? '—' : t('videoStudio.form.generating')}
                    </div>
                  )}
                  {src && (
                    <a href={src.replace('/stream/', '/download/')} download>
                      {t('videoStudio.tasks.download')}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
      <span style={{ color: 'var(--color-text-3)' }}>{label}</span>
      {children}
    </label>
  );
}

function LlmConfigForm({
  onSubmit,
}: {
  onSubmit: (p: string, k: string, u: string, m: string) => void;
}) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  return (
    <section
      style={{
        border: '1px solid var(--color-border-2)',
        borderRadius: 12,
        padding: 16,
        marginBottom: 20,
      }}
    >
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>
        {t('videoStudio.page.configure')}
      </h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <input placeholder='provider (deepseek/moonshot)' value={provider} onChange={(e) => setProvider(e.target.value)} />
        <input placeholder='api_key' type='password' value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        <input placeholder='base_url (optional)' value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        <input placeholder='model (optional)' value={model} onChange={(e) => setModel(e.target.value)} />
      </div>
      <button
        onClick={() => onSubmit(provider, apiKey, baseUrl, model)}
        style={{
          marginTop: 12,
          padding: '6px 14px',
          borderRadius: 8,
          border: 'none',
          background: 'var(--primary-6)',
          color: '#fff',
          cursor: 'pointer',
        }}
      >
        {t('videoStudio.page.configure')}
      </button>
    </section>
  );
}

export default VideoStudioPage;
