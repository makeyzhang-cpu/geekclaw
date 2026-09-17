/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tooltip } from '@arco-design/web-react';
import { Check, Close, Loading, Plug, Time } from '@icon-park/react';
import classNames from 'classnames';
import { platformSpec } from './platforms';
import type { SocialPlatform } from './types';

interface PlatformBadgeProps {
  platform: SocialPlatform;
  /** 尺寸：列表页用 sm，卡片头用 md。 */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * 平台徽标。
 *
 * 用品牌色方块 + 平台短名，而不是各家 logo：一是避免引入商标资源，
 * 二是短名（in / fb / ig / yt / X / tt）在窄栏与日历格子里可读性更稳。
 */
export const PlatformBadge: React.FC<PlatformBadgeProps> = ({
  platform,
  size = 'md',
  className,
}) => {
  const spec = platformSpec(platform);
  const dimension = size === 'sm' ? 16 : 20;
  return (
    <Tooltip content={spec.label} position='top'>
      <span
        className={classNames(
          'inline-flex items-center justify-center rounded-4px font-[600] leading-none shrink-0 select-none',
          size === 'sm' ? 'text-10px' : 'text-11px',
          className
        )}
        style={{
          width: dimension,
          height: dimension,
          background: spec.color,
          color: '#fff',
        }}
      >
        {spec.short}
      </span>
    </Tooltip>
  );
};

type DotStatus = 'ok' | 'warn' | 'error' | 'idle';

const DOT_COLOR: Record<DotStatus, string> = {
  ok: '#00b42a',
  warn: '#ff7d00',
  error: '#f53f3f',
  idle: '#c9cdd4',
};

/** 小状态点（已连接 / 待重授权 / 异常 / 未接入）。 */
export const StatusDot: React.FC<{ status: DotStatus; className?: string }> = ({
  status,
  className,
}) => (
  <span
    className={classNames('inline-block size-6px rounded-full shrink-0', className)}
    style={{ background: DOT_COLOR[status] }}
  />
);

/** 投递状态图标（成功 / 失败 / 排队中 / 进行中 / 已跳过）。 */
export const DeliveryIcon: React.FC<{
  status: 'success' | 'failed' | 'pending' | 'queued' | 'skipped';
}> = ({ status }) => {
  if (status === 'success') return <Check theme='outline' size={12} fill='#00b42a' />;
  if (status === 'failed') return <Close theme='outline' size={12} fill='#f53f3f' />;
  // 排队用时钟而不是转圈：转圈意味着「马上就好」，而限流退避可能等上
  // 几十分钟。用错图标会让用户以为界面卡住了，进而手动重发。
  if (status === 'queued') return <Time theme='outline' size={12} fill='#ff7d00' />;
  if (status === 'pending') return <Loading theme='outline' size={12} fill='#86909c' />;
  return <Plug theme='outline' size={12} fill='#c9cdd4' />;
};

export default PlatformBadge;
