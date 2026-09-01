/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * AvatarSpeaker — 数字分身口型动画组件（低保真）。
 *
 * 展示形象（默认内置简笔人脸，或传 `src` 用自定义图/照片 = 形象克隆），
 * 调用 `speak(audioUrl)` 播放音频时，用 Web Audio AnalyserNode 实时读取音量，
 * 驱动口型（SVG 椭圆）开合 —— 即「形象在动口型在变化」。
 *
 * 用法：
 *   const ref = useRef<AvatarSpeakerHandle>(null);
 *   <AvatarSpeaker ref={ref} src={figureUrl} lipsyncStyle="expressive" />;
 *   ref.current?.speak(objectUrl);   // 播放并同步口型
 */
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';

export interface AvatarSpeakerHandle {
  /** 播放一段音频并同步口型动画。audioUrl 为 blob/object URL 或远程音频地址。 */
  speak: (audioUrl: string) => Promise<void>;
  /** 立即停止。 */
  stop: () => void;
}

interface AvatarSpeakerProps {
  /** 形象图 URL（如数字分身照片 = 低保真形象克隆）；缺省用内置简笔人脸。 */
  src?: string;
  /** 渲染尺寸（px）。 */
  size?: number;
  /** 口型样式：basic 自然 / expressive 幅度更大 / cartoon 夸张。 */
  lipsyncStyle?: 'basic' | 'expressive' | 'cartoon';
}

const GAIN: Record<string, number> = { basic: 1, expressive: 1.5, cartoon: 2.2 };

export const AvatarSpeaker = forwardRef<AvatarSpeakerHandle, AvatarSpeakerProps>(
  ({ src, size = 160, lipsyncStyle = 'basic' }, ref) => {
    const [level, setLevel] = useState(0);
    const [speaking, setSpeaking] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const ctxRef = useRef<AudioContext | null>(null);
    const rafRef = useRef<number | null>(null);

    const cleanup = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (ctxRef.current) {
        ctxRef.current.close().catch(() => undefined);
        ctxRef.current = null;
      }
      setSpeaking(false);
      setLevel(0);
    };

    useImperativeHandle(ref, () => ({
      speak: (audioUrl: string) =>
        new Promise<void>((resolve) => {
          cleanup();
          const AudioCtx: typeof AudioContext =
            window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new AudioCtx();
          ctxRef.current = ctx;
          const audio = new Audio(audioUrl);
          audio.crossOrigin = 'anonymous';
          audioRef.current = audio;

          const source = ctx.createMediaElementSource(audio);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          analyser.connect(ctx.destination);

          const buf = new Uint8Array(analyser.fftSize);
          const gain = GAIN[lipsyncStyle] ?? 1;
          const tick = () => {
            analyser.getByteTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) {
              const v = (buf[i] - 128) / 128;
              sum += v * v;
            }
            const rms = Math.sqrt(sum / buf.length);
            setLevel(Math.min(1, rms * 3.4 * gain));
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);

          audio.onended = () => {
            cleanup();
            resolve();
          };
          audio.onerror = () => {
            cleanup();
            resolve();
          };
          setSpeaking(true);
          ctx
            .resume()
            .then(() => audio.play())
            .catch(() => {
              cleanup();
              resolve();
            });
        }),
      stop: cleanup,
    }));

    const mouthRy = 4 + level * 18;
    return (
      <div style={{ width: size, textAlign: 'center', userSelect: 'none' }}>
        <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
          {src ? (
            <img
              src={src}
              alt="数字分身"
              style={{ width: size, height: size, objectFit: 'contain', borderRadius: 12 }}
            />
          ) : (
            <svg width={size} height={size} viewBox="0 0 160 160">
              <circle cx="80" cy="80" r="66" fill="#cfe3ff" />
              <circle cx="58" cy="68" r="8" fill="#22324a" />
              <circle cx="102" cy="68" r="8" fill="#22324a" />
            </svg>
          )}
          {/* 口型叠层：图像模式下置于底部中央；默认人脸置于嘴部 */}
          <svg
            width={size}
            height={size}
            viewBox="0 0 160 160"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            <ellipse
              cx="80"
              cy={src ? 118 : 104}
              rx="20"
              ry={Math.min(mouthRy, 22)}
              fill={speaking ? '#b3431f' : '#7a4a35'}
              opacity={src ? 0.92 : 1}
            />
          </svg>
        </div>
        {speaking && (
          <div style={{ marginTop: 6, fontSize: 12, color: '#2a6df4' }}>● 正在说话</div>
        )}
      </div>
    );
  }
);

AvatarSpeaker.displayName = 'AvatarSpeaker';

export default AvatarSpeaker;
