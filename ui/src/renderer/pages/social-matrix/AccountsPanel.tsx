/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState } from 'react';
import { Button, Message, Popconfirm, Spin, Tag, Tooltip } from '@arco-design/web-react';
import { Delete, Link, Refresh, Time, User } from '@icon-park/react';
import classNames from 'classnames';
import { PlatformBadge, StatusDot } from './PlatformBadge';
import { platformSpec } from './platforms';
import { disconnectAccount, requestAuthUrl } from './cloudApi';
import type { SocialAccount, SocialPlatform } from './types';

interface AccountsPanelProps {
  accountsByPlatform: Map<SocialPlatform, SocialAccount[]>;
  platformState: {
    platform: SocialPlatform;
    configured: boolean;
    accountCount: number;
    connected: boolean;
    needsReauth: boolean;
  }[];
  /** 演示模式下禁止任何写操作。 */
  demo: boolean;
  reload: () => void | Promise<void>;
}

const formatExpiry = (expiresAt?: number): { text: string; warn: boolean } | null => {
  if (!expiresAt) return null;
  const days = Math.floor((expiresAt - Date.now()) / 86_400_000);
  if (days < 0) return { text: '授权已过期', warn: true };
  if (days <= 7) return { text: `${days} 天后到期`, warn: true };
  return { text: `${days} 天后到期`, warn: false };
};

/**
 * AccountsPanel — 账号矩阵。
 *
 * 6 个平台固定列出（不因未接入而隐藏），因为「哪些平台还没接」本身就是要
 * 让用户一眼看到的信息。每个平台有三种状态：
 *   - **待接入**：服务端还没有可用的发布通道 → 给出需要配置什么的说明；
 *   - **未连接**：通道已就绪，但用户还没授权任何账号 → 给出「连接」按钮；
 *   - **已连接**：列出账号卡片，含授权有效期与可发布目标。
 *
 * 「待接入」是**如实上报的一等状态**，不是故障：首期走聚合 API，服务商已持有
 * 各平台的过审应用，所以管理员只需要在后台填一次 API Key，无需为每个平台
 * 单独申请企业开发者应用。填好后这些平台会自动变为「未连接」。
 */
const AccountsPanel: React.FC<AccountsPanelProps> = ({
  accountsByPlatform,
  platformState,
  demo,
  reload,
}) => {
  const [busyPlatform, setBusyPlatform] = useState<SocialPlatform | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  /** 一个平台都没接入 → 给一条整体说明，避免逐平台重复 6 遍同样的话。 */
  const noneConfigured = platformState.every((p) => !p.configured);

  /** 首期投放平台（不含 X）的显示名，用于整体说明里点名。 */
  const launchLabels = platformState
    .filter((p) => p.platform !== 'x')
    .map((p) => platformSpec(p.platform).label)
    .join(' / ');

  const handleConnect = useCallback(
    async (platform: SocialPlatform) => {
      setBusyPlatform(platform);
      try {
        const url = await requestAuthUrl(platform);
        // 用系统浏览器打开授权页：平台侧往往禁止在应用内 webview 完成 OAuth。
        window.open(url, '_blank', 'noopener,noreferrer');
        Message.info('已在新窗口打开授权页，完成授权后返回本页刷新即可。');
      } catch (error) {
        console.error('[social-matrix] connect failed', error);
        Message.error('无法获取授权地址：该平台的发布通道还没接入。请先在云端后台配置聚合服务 API Key。');
      } finally {
        setBusyPlatform(null);
      }
    },
    []
  );

  const handleDisconnect = useCallback(
    async (account: SocialAccount) => {
      setDisconnectingId(account.id);
      try {
        await disconnectAccount(account.id);
        Message.success(`已断开 ${account.name}`);
        await reload();
      } catch (error) {
        console.error('[social-matrix] disconnect failed', error);
        Message.error('断开失败，请稍后重试。');
      } finally {
        setDisconnectingId(null);
      }
    },
    [reload]
  );

  return (
    <div className='flex flex-col gap-12px'>
      {noneConfigured && (
        <div className='box-border rounded-8px border border-solid border-[#ff7d00] bg-[#fff7e8] px-16px py-12px text-12px leading-20px text-t-primary'>
          <span className='font-[600]'>发布通道尚未接入。</span>
          服务端目前没有可真实投递的平台，所以下面 6 个平台都显示为「待接入」——这是如实上报，不是故障。
          管理员在云端后台填入聚合服务 API Key 后，{launchLabels} 会自动变为「连接账号」；
          聚合商已持有各平台过审应用，无需再逐个申请企业开发者应用。
        </div>
      )}
      {platformState.map(({ platform, configured, accountCount, connected, needsReauth }) => {
        const spec = platformSpec(platform);
        const accounts = accountsByPlatform.get(platform) ?? [];
        const dotStatus = !configured
          ? 'idle'
          : needsReauth
            ? 'warn'
            : connected
              ? 'ok'
              : 'idle';

        return (
          <div
            key={platform}
            className='box-border rounded-8px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] px-16px py-12px'
          >
            {/* 平台头 */}
            <div className='flex items-center gap-10px'>
              <PlatformBadge platform={platform} />
              <span className='text-14px font-[600] text-t-primary'>{spec.label}</span>
              <StatusDot status={dotStatus} />
              <span className='text-12px text-t-tertiary'>
                {!configured
                  ? '待接入'
                  : accountCount > 0
                    ? `${accountCount} 个账号`
                    : '未连接账号'}
              </span>

              <div className='flex-1' />

              {configured && (
                <Button
                  size='small'
                  type={accountCount > 0 ? 'secondary' : 'primary'}
                  icon={<Link theme='outline' size={14} />}
                  loading={busyPlatform === platform}
                  disabled={demo}
                  onClick={() => void handleConnect(platform)}
                >
                  {accountCount > 0 ? '添加账号' : '连接账号'}
                </Button>
              )}
            </div>

            {/* 未接入发布通道：如实说明，不假装可用 */}
            {!configured && (
              <div className='mt-10px box-border rounded-6px bg-[var(--color-fill-1)] px-12px py-10px text-12px leading-20px text-t-tertiary'>
                该平台的发布通道尚未在服务端接入。
                {spec.caveat ? ` 另外注意：${spec.caveat}` : ''}
                管理员在云端后台填入聚合服务 API Key 后，此处会自动变为「连接账号」。
              </div>
            )}

            {/* 平台能力提示（已配置时也展示，避免用户踩坑） */}
            {configured && spec.caveat && (
              <div className='mt-10px text-12px leading-20px text-t-tertiary'>{spec.caveat}</div>
            )}

            {configured && spec.authVia !== spec.id && (
              <div className='mt-6px text-12px leading-20px text-[#ff7d00]'>
                授权入口在 {platformSpec(spec.authVia).label}，需用已关联该平台的主页完成授权。
              </div>
            )}

            {/* 账号卡片 */}
            {accounts.length > 0 && (
              <div className='mt-12px flex flex-col gap-8px'>
                {accounts.map((account) => {
                  const expiry = formatExpiry(account.expiresAt);
                  return (
                    <div
                      key={account.id}
                      className={classNames(
                        'flex items-center gap-10px box-border rounded-6px px-12px py-10px',
                        account.status === 'connected'
                          ? 'bg-[var(--color-fill-1)]'
                          : 'bg-[#fff7e8]'
                      )}
                    >
                      <User theme='outline' size={16} />
                      <div className='flex flex-col leading-18px min-w-0'>
                        <span className='text-13px text-t-primary truncate'>{account.name}</span>
                        {account.handle && (
                          <span className='text-11px text-t-tertiary truncate'>
                            @{account.handle}
                          </span>
                        )}
                      </div>

                      {account.status !== 'connected' && (
                        <Tag size='small' color='orange'>
                          {account.status === 'expired' ? '授权过期' : '需重新授权'}
                        </Tag>
                      )}

                      {/* 可发布目标 */}
                      {account.targets && account.targets.length > 0 && (
                        <Tooltip
                          position='top'
                          content={
                            <div className='flex flex-col gap-2px'>
                              {account.targets.map((target) => (
                                <span key={target.id}>{target.name}</span>
                              ))}
                            </div>
                          }
                        >
                          <Tag size='small'>{account.targets.length} 个发布目标</Tag>
                        </Tooltip>
                      )}

                      <div className='flex-1' />

                      {expiry && (
                        <span
                          className={classNames(
                            'text-11px flex items-center gap-4px',
                            expiry.warn ? 'text-[#ff7d00]' : 'text-t-tertiary'
                          )}
                        >
                          <Time theme='outline' size={12} />
                          {expiry.text}
                        </span>
                      )}

                      <Popconfirm
                        title={`断开 ${account.name}？`}
                        content='断开后该账号的排期帖将无法投递，需要重新授权。'
                        okText='断开'
                        cancelText='取消'
                        disabled={demo}
                        onOk={() => void handleDisconnect(account)}
                      >
                        <Button
                          size='mini'
                          type='text'
                          status='danger'
                          icon={<Delete theme='outline' size={14} />}
                          loading={disconnectingId === account.id}
                          disabled={demo}
                        />
                      </Popconfirm>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <div className='flex justify-end'>
        <Button
          size='small'
          icon={<Refresh theme='outline' size={14} />}
          onClick={() => void reload()}
        >
          刷新
        </Button>
      </div>
    </div>
  );
};

export default AccountsPanel;
