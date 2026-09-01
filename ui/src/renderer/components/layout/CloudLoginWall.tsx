/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useCloudAuth } from '@renderer/hooks/context/CloudAuthContext';

/**
 * Full-screen gate shown on the desktop shell before the cloud account is
 * authenticated. The user cannot reach the main interface until they sign in
 * (or register) via the system browser.
 *
 * Visual language follows the GeekClaw marketing site (geekclaw.ai):
 * warm off-white canvas, Alibaba-orange (#FF6A00) accent, soft glow,
 * rounded glass card.
 */
const CloudLoginWall: React.FC = () => {
  const { t } = useTranslation();
  const { login, busy } = useCloudAuth();

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(1200px 800px at 50% -20%, #ffe9d6 0%, #fff8f5 48%, #fff8f5 100%)',
        color: '#1a1a1a',
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        padding: '24px',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {/* warm glow accents */}
      <div
        style={{
          position: 'absolute',
          top: '-12%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 520,
          height: 520,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,106,0,0.16), transparent 62%)',
          filter: 'blur(8px)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '-15%',
          right: '-8%',
          width: 360,
          height: 360,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,143,0,0.12), transparent 60%)',
          filter: 'blur(6px)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'relative',
          width: 'min(440px, 92vw)',
          background: 'rgba(255,255,255,0.88)',
          border: '1px solid #f0e6e0',
          borderRadius: 24,
          padding: '46px 38px',
          textAlign: 'center',
          backdropFilter: 'blur(14px)',
          boxShadow: '0 20px 60px rgba(255,106,0,0.18)',
        }}
      >
        <img
          src="/geekclaw-claw.png"
          alt="GeekClaw"
          draggable={false}
          style={{
            width: 78,
            height: 78,
            margin: '0 auto 22px',
            borderRadius: '50%',
            objectFit: 'cover',
            boxShadow: '0 12px 34px rgba(255,106,0,0.30)',
          }}
        />

        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
            margin: '0 0 10px',
            letterSpacing: 0.5,
            color: '#1a1a1a',
          }}
        >
          GeekClaw
        </h1>
        <p
          style={{
            fontSize: 15,
            color: '#666666',
            margin: '0 0 30px',
            lineHeight: 1.7,
          }}
        >
          {t('common.cloudLoginWall.subtitle')}
        </p>

        <button
          type="button"
          onClick={() => void login()}
          disabled={busy}
          style={{
            width: '100%',
            padding: '15px 20px',
            fontSize: 16,
            fontWeight: 700,
            color: '#ffffff',
            border: 'none',
            borderRadius: 14,
            cursor: busy ? 'default' : 'pointer',
            background: busy
              ? 'linear-gradient(135deg, #ffb066 0%, #ffc14d 100%)'
              : 'linear-gradient(135deg, #ff6a00 0%, #ff8f00 100%)',
            boxShadow: busy ? 'none' : '0 12px 28px rgba(255,106,0,0.35)',
            transition: 'transform 0.1s ease, box-shadow 0.2s ease',
          }}
        >
          {busy ? t('common.cloudLoginWall.waiting') : t('common.cloudLoginWall.cta')}
        </button>

        <p
          style={{
            fontSize: 12.5,
            color: '#999999',
            margin: '18px 0 0',
            lineHeight: 1.6,
          }}
        >
          {t('common.cloudLoginWall.hint')}
        </p>
      </div>
    </div>
  );
};

export default CloudLoginWall;
