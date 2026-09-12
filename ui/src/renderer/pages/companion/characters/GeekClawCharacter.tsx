/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { CharacterProps } from './types';
import logoUrl from '@/renderer/assets/logos/brand/geekclaw-claw.png';

/**
 * 品牌化角色:所有非自定义数字员工统一使用 GeekClaw 爪形 logo,
 * 取代 nomifun 默认的 mochi / ink / bolt 动画角色,确保桌面端视觉与品牌一致。
 * mood / activity / size 入参保留以兼容 CharacterProps,但 logo 为静态图,不响应动画状态。
 */
const GeekClawCharacter: React.FC<CharacterProps> = ({ size = 150 }) => {
  return (
    <img
      src={logoUrl}
      alt='GeekClaw'
      width={size}
      height={size}
      style={{ objectFit: 'contain', display: 'block' }}
    />
  );
};

export default GeekClawCharacter;
