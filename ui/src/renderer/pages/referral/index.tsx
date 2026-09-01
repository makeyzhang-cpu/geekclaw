/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useCloudAuth } from '@renderer/hooks/context/CloudAuthContext';
import { httpRequest } from '@/common/adapter/httpBridge';
import './referral.css';

interface ReferralInfo {
  inviteCode?: string;
  inviteLink?: string;
  invitedCount?: number;
  earnedCredits?: number;
}

const ReferralPage: React.FC = () => {
  const { t } = useTranslation();
  const cloud = useCloudAuth();
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Cloud-owned referral data. The desktop proxies this to the cloud backend
      // (which owns the referral data) via the local `/api/store/referral/info`
      // route using the stored cloud JWT. Falls back gracefully when unavailable.
      // `httpRequest` strips the `{ success, data }` envelope, so `res` is the
      // inner `ReferralInfo` payload directly (no `.success`/`.data` wrapper).
      const res = await httpRequest<ReferralInfo>('GET', '/api/store/referral/info');
      setInfo(res ?? null);
    } catch {
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const inviteLink = useMemo(() => {
    if (info?.inviteLink) return info.inviteLink;
    const code = info?.inviteCode || cloud.state.user?.username || '';
    if (!code) return '';
    return `https://www.geekclaw.ai/register?invite=${encodeURIComponent(code)}`;
  }, [info, cloud.state.user?.username]);

  const handleCopy = useCallback(async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      Message.success(t('common.copied') || '已复制');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      Message.error(t('common.copyFailed') || '复制失败');
    }
  }, [inviteLink, t]);

  return (
    <div className='referral-page'>
      <header className='referral-header'>
        <h1 className='referral-title'>分享邀约有奖分销</h1>
        <p className='referral-subtitle'>邀请好友注册使用 GeekClaw，双方均可获得积分奖励</p>
      </header>

      {loading ? (
        <div className='referral-loading'>{t('billing.loading')}</div>
      ) : (
        <div className='referral-body'>
          <div className='referral-card'>
            <div className='referral-card-title'>我的专属邀请</div>
            <div className='referral-row'>
              <div className='referral-field'>
                <span className='referral-label'>邀请码</span>
                <span className='referral-value'>{info?.inviteCode || cloud.state.user?.username || '—'}</span>
              </div>
              <div className='referral-field'>
                <span className='referral-label'>已邀请人数</span>
                <span className='referral-value'>{info?.invitedCount ?? 0}</span>
              </div>
              <div className='referral-field'>
                <span className='referral-label'>累计获得积分</span>
                <span className='referral-value'>{info?.earnedCredits ?? 0}</span>
              </div>
            </div>

            <div className='referral-link'>
              <input
                className='referral-link-input'
                value={inviteLink}
                readOnly
                placeholder={cloud.state.authenticated ? '' : '请先登录云端账号'}
              />
              <button
                type='button'
                className='referral-copy-btn'
                disabled={!inviteLink}
                onClick={() => void handleCopy()}
              >
                {copied ? '已复制' : '复制链接'}
              </button>
            </div>

            <ul className='referral-rules'>
              <li>每成功邀请 1 位好友注册，双方各得奖励积分。</li>
              <li>奖励实时发放到云端积分账户，可在「积分余额」查看。</li>
              <li>具体奖励比例以管理后台配置为准。</li>
            </ul>
          </div>

          <div className='referral-tip'>
            说明：分销奖励规则与数据由云端管理后台统一配置，桌面端仅做展示与分享。如需调整奖励策略，请联系运营或前往管理后台。
          </div>
        </div>
      )}
    </div>
  );
};

export default ReferralPage;
