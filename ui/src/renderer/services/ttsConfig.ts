/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { configService } from '@/common/config/configService';
import type { TtsConfig } from '@/common/config/configKeys';
import type { ProviderId } from '@/common/types/ids';
import { synthesizeSpeech, type TtsSynthesisResult } from './TtsService';

export const TTS_CONFIG_KEY = 'tools.tts' as const;
export const TTS_CONFIG_CHANGED_EVENT = 'geekclaw:tts-config-changed';

export const DEFAULT_TTS_CONFIG: TtsConfig = {
  enabled: false,
  autoPlay: false,
  format: 'mp3',
};

export const normalizeTtsConfig = (config?: TtsConfig): TtsConfig => {
  if (!config) return DEFAULT_TTS_CONFIG;
  return {
    ...DEFAULT_TTS_CONFIG,
    ...config,
    format: config.format || 'mp3',
  };
};

export const getTtsConfig = (): TtsConfig => normalizeTtsConfig(configService.get(TTS_CONFIG_KEY));

export const isTtsReady = (config: TtsConfig): boolean =>
  config.enabled && Boolean(config.provider_id) && Boolean(config.model);

export const saveTtsConfig = async (config: TtsConfig): Promise<void> => {
  const normalized = normalizeTtsConfig(config);
  try {
    await configService.set(TTS_CONFIG_KEY, normalized);
  } catch (error) {
    await configService.reload();
    throw error;
  } finally {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(TTS_CONFIG_CHANGED_EVENT));
    }
  }
};

/** Singleton audio element so a new playback interrupts the previous one. */
let audioEl: HTMLAudioElement | null = null;

export const playTtsAudio = (result: TtsSynthesisResult): Promise<void> => {
  if (audioEl) {
    audioEl.pause();
    if (audioEl.src.startsWith('blob:')) URL.revokeObjectURL(audioEl.src);
  }
  const url = URL.createObjectURL(result.blob);
  audioEl = new Audio(url);
  audioEl.playbackRate = 1;
  return audioEl.play().catch((err) => {
    console.error('TTS playback failed', err);
  });
};

/** Synthesize and play `text` using the provided config. Throws if not ready. */
export const speakText = async (text: string, config: TtsConfig): Promise<void> => {
  if (!isTtsReady(config)) throw new Error('TTS_NOT_CONFIGURED');
  const result = await synthesizeSpeech({
    providerId: config.provider_id as ProviderId,
    model: config.model as string,
    text,
    voice: config.voice,
    format: config.format,
  });
  await playTtsAudio(result);
};
