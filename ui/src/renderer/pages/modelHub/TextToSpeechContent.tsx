/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Empty, Form, Input, Select, Switch } from '@arco-design/web-react';
import { LinkCloud, Sound } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { ProviderId } from '@/common/types/ids';
import NomiSelect from '@/renderer/components/base/NomiSelect';
import { useModelsForTask } from '@/renderer/hooks/agent/useModelsForTask';
import { useArcoMessage } from '@/renderer/utils/ui/useArcoMessage';
import { useModelSelectorProviderLabel } from '@/renderer/hooks/agent/useModelSelectorProviderLabel';
import {
  DEFAULT_TTS_CONFIG,
  getTtsConfig,
  isTtsReady,
  normalizeTtsConfig,
  saveTtsConfig,
  speakText,
  TTS_CONFIG_CHANGED_EVENT,
} from '@/renderer/services/ttsConfig';
import { synthesizeSpeech } from '@/renderer/services/TtsService';
import AvatarSpeaker, { type AvatarSpeakerHandle } from '@/renderer/components/AvatarSpeaker/AvatarSpeaker';

type TtsSourceOption = {
  value: string;
  label: string;
  providerId?: ProviderId;
  model: string;
};

const TTS_TEST_TEXT = '你好，我是你的数字分身伙伴，有什么可以帮你的吗？';

const TextToSpeechContent: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [message, messageContext] = useArcoMessage({ maxCount: 2 });
  const [config, setConfig] = useState<TtsConfigLike>(DEFAULT_TTS_CONFIG);
  const [testing, setTesting] = useState(false);
  const avatarRef = useRef<AvatarSpeakerHandle>(null);

  // Candidate TTS models come from per-model `speech_synthesis` task tags.
  const { groups: ttsGroups } = useModelsForTask('speech_synthesis');
  const providerLabel = useModelSelectorProviderLabel();

  useEffect(() => {
    const syncConfig = () => setConfig(getTtsConfig());
    syncConfig();
    window.addEventListener(TTS_CONFIG_CHANGED_EVENT, syncConfig);
    return () => window.removeEventListener(TTS_CONFIG_CHANGED_EVENT, syncConfig);
  }, []);

  const cloudOptions = useMemo<TtsSourceOption[]>(() => {
    return ttsGroups.flatMap(({ provider, models }) =>
      models.map((model) => ({
        value: `cloud\u0000${provider.id}\u0000${model}`,
        label: `${providerLabel(provider)} · ${model}`,
        providerId: provider.id,
        model,
      }))
    );
  }, [ttsGroups, providerLabel]);

  const selectedSource = useMemo(() => {
    return cloudOptions.find(
      (option) => option.providerId === config.provider_id && option.model === config.model
    )?.value;
  }, [cloudOptions, config.model, config.provider_id]);

  const persist = useCallback(
    (next: TtsConfigLike) => {
      const normalized = normalizeTtsConfig(next);
      setConfig(normalized);
      void saveTtsConfig(normalized).catch((error) => {
        console.error('Failed to save TTS config:', error);
        setConfig(getTtsConfig());
        message.error(error instanceof Error ? error.message : t('settings.saveModelConfigFailed'));
      });
    },
    [message, t]
  );

  const selectSource = useCallback(
    (value: string) => {
      const option = cloudOptions.find((candidate) => candidate.value === value);
      if (!option) return;
      persist({
        ...config,
        enabled: true,
        provider_id: option.providerId,
        model: option.model,
      });
    },
    [cloudOptions, config, persist]
  );

  const handleTest = useCallback(async () => {
    if (!isTtsReady(config)) {
      message.warning(t('settings.modelHub.tts.notConfigured'));
      return;
    }
    setTesting(true);
    try {
      // 合成音频（不自动播放），交给数字分身口型动画组件播放 + 动口型。
      const result = await synthesizeSpeech({
        providerId: config.provider_id as ProviderId,
        model: config.model as string,
        text: TTS_TEST_TEXT,
        voice: config.voice,
        format: config.format,
      });
      const url = URL.createObjectURL(result.blob);
      await avatarRef.current?.speak(url);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('settings.modelHub.tts.testFailed'));
    } finally {
      setTesting(false);
    }
  }, [config, message, t, avatarRef]);

  return (
    <div className='flex min-h-0 flex-col rd-16px bg-2 px-24px py-16px'>
      {messageContext}
      <header className='flex items-center gap-9px border-b border-b-solid border-[var(--color-border-2)] pb-14px'>
        <span className='size-30px shrink-0 flex items-center justify-center rd-9px bg-primary-1 text-primary-6'>
          <Sound theme='outline' size='18' strokeWidth={3} />
        </span>
        <div className='min-w-0'>
          <h2 className='m-0 text-20px font-650 leading-28px text-t-primary'>
            {t('settings.modelHub.tts.title')}
          </h2>
          <p className='m-0 mt-2px text-12px leading-18px text-t-secondary'>
            {t('settings.modelHub.tts.subtitle')}
          </p>
        </div>
      </header>

      {cloudOptions.length === 0 ? (
        <div className='py-42px'>
          <Empty
            icon={<Sound theme='outline' size='42' className='text-t-tertiary' />}
            description={t('settings.modelHub.tts.noSources')}
          />
          <div className='mt-14px flex items-center justify-center gap-8px flex-wrap'>
            <Button icon={<LinkCloud theme='outline' size='14' />} onClick={() => navigate('/models?section=models')}>
              {t('settings.modelHub.tts.manageProviders')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className='mt-14px flex justify-center'>
            <AvatarSpeaker ref={avatarRef} size={132} lipsyncStyle='expressive' />
          </div>
          <Form layout='vertical' className='mt-18px'>
            <Form.Item label={t('settings.modelHub.tts.source')}>
              <NomiSelect value={selectedSource} onChange={selectSource}>
                {cloudOptions.length > 0 && (
                  <NomiSelect.OptGroup label={t('settings.modelHub.tts.cloud')}>
                    {cloudOptions.map((option) => (
                      <NomiSelect.Option key={option.value} value={option.value}>
                        {option.label}
                      </NomiSelect.Option>
                    ))}
                  </NomiSelect.OptGroup>
                )}
              </NomiSelect>
            </Form.Item>
            <Form.Item label={t('settings.modelHub.tts.voice')}>
              <Input
                value={config.voice ?? ''}
                placeholder={t('settings.modelHub.tts.voicePlaceholder')}
                onChange={(voice) => setConfig((current) => ({ ...current, voice }))}
                onBlur={() => persist(config)}
              />
            </Form.Item>
            <Form.Item label={t('settings.modelHub.tts.format')}>
              <Select
                value={config.format ?? 'mp3'}
                onChange={(format) => persist({ ...config, format })}
              >
                <Select.Option value='mp3'>MP3</Select.Option>
                <Select.Option value='wav'>WAV</Select.Option>
                <Select.Option value='opus'>OPUS</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item label={t('settings.modelHub.tts.enabled')}>
              <Switch
                checked={config.enabled && Boolean(selectedSource)}
                disabled={!selectedSource}
                onChange={(enabled) => persist({ ...config, enabled })}
              />
            </Form.Item>
            <Form.Item label={t('settings.modelHub.tts.autoPlay')}>
              <Switch
                checked={Boolean(config.autoPlay) && config.enabled && Boolean(selectedSource)}
                disabled={!config.enabled || !selectedSource}
                onChange={(autoPlay) => persist({ ...config, autoPlay })}
              />
            </Form.Item>
          </Form>

          <div className='mt-6px flex items-center gap-8px flex-wrap'>
            <Button
              type='primary'
              size='small'
              loading={testing}
              icon={<Sound theme='outline' size='14' />}
              onClick={handleTest}
              disabled={!isTtsReady(config)}
            >
              {t('settings.modelHub.tts.testPlay')}
            </Button>
            <Button
              type='text'
              size='small'
              icon={<LinkCloud theme='outline' size='14' />}
              onClick={() => navigate('/models?section=models')}
            >
              {t('settings.modelHub.tts.manageProviders')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

/** Local alias so this panel can hold the config shape without a circular import surface. */
type TtsConfigLike = ReturnType<typeof normalizeTtsConfig>;

export default TextToSpeechContent;
