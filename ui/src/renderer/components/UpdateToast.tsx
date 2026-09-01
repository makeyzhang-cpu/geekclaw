/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Download, Refresh, CloseOne } from '@icon-park/react';
import { ipcBridge } from '@/common';
import { useTranslation } from 'react-i18next';
import type { AutoUpdateStatus } from '@/common/update/updateTypes';

/**
 * Silent-update toast anchored bottom-left, sitting just above the user menu.
 * The desktop shell checks for updates quietly in the background; when a new
 * build has been pushed and downloaded, we surface a single non-modal prompt
 * ("新版本，请点击安装") instead of popping the full modal — the user decides
 * when to install.
 */
const UpdateToast: React.FC = () => {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'downloading' | 'downloaded' | 'error' | null>(null);
  const [version, setVersion] = useState('');
  const [percent, setPercent] = useState(0);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const remove = ipcBridge.autoUpdate.status.on((evt: AutoUpdateStatus) => {
      if (!evt) return;
      switch (evt.status) {
        case 'available':
          setVersion(evt.version || '');
          setPhase('downloading');
          setDismissed(false);
          setVisible(true);
          break;
        case 'downloading':
          setPhase('downloading');
          setVisible(true);
          if (evt.progress) setPercent(Math.round(evt.progress.percent));
          break;
        case 'downloaded':
          setPhase('downloaded');
          setDismissed(false);
          setVisible(true);
          break;
        case 'error':
          setPhase('error');
          break;
        case 'not-available':
          setVisible(false);
          break;
        default:
          break;
      }
    });
    return () => {
      remove();
    };
  }, []);

  if (!visible || dismissed) return null;

  const handleInstall = () => {
    void ipcBridge.autoUpdate.quitAndInstall
      .invoke()
      .catch((error) => console.error('[UpdateToast] install failed', error));
  };

  return (
    <div
      className='fixed left-16px bottom-[72px] z-[1000] w-[260px] rounded-12px border border-[var(--color-border-2)] bg-[var(--color-bg-1)] shadow-[0_8px_28px_rgba(0,0,0,0.18)] px-14px py-12px flex items-center gap-10px'
      role='alert'
    >
      <span className='shrink-0 size-32px rounded-8px bg-[rgba(var(--primary-6),0.12)] flex items-center justify-center'>
        <Download size='18' fill='rgb(var(--primary-6))' />
      </span>
      <div className='flex-1 min-w-0'>
        {phase === 'downloading' ? (
          <>
            <div className='text-13px font-500 text-t-primary'>正在下载新版本{version ? ` v${version}` : ''}</div>
            <div className='text-12px text-t-tertiary'>{percent}%</div>
          </>
        ) : phase === 'downloaded' ? (
          <div className='text-13px font-500 text-t-primary'>新版本，请点击安装{version ? ` v${version}` : ''}</div>
        ) : (
          <div className='text-13px font-500 text-danger-6'>更新失败，请稍后重试</div>
        )}
      </div>
      {phase === 'downloaded' ? (
        <button
          type='button'
          className='shrink-0 text-13px text-primary-6 font-500 px-10px h-28px rounded-8px hover:bg-fill-2 active:bg-fill-3'
          onClick={handleInstall}
        >
          {t('update.installNow')}
        </button>
      ) : phase === 'downloading' ? (
        <Refresh size='14' fill='var(--primary-6)' className='shrink-0 animate-spin' />
      ) : null}
      <button
        type='button'
        className='shrink-0 text-t-tertiary hover:text-t-primary'
        aria-label='关闭'
        onClick={() => setDismissed(true)}
      >
        <CloseOne size='14' />
      </button>
    </div>
  );
};

export default UpdateToast;
