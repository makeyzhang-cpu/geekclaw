/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { pickPersonFigure } from '@renderer/pages/companion/characters/builtinFigures';

interface PersonAvatarProps {
  /** 稳定分配种子（专家 id / 名称）—— 同一 seed 永远是同一张形象。 */
  seed: string;
  size: number;
  /** 圆形（默认）或圆角方形。 */
  shape?: 'circle' | 'square';
  className?: string;
  title?: string;
  /**
   * 已由上层（名册级 `assignPersonFigures`）分配好的形象图；缺省按 seed 现算。
   * 名册与工作台头部必须传同一份分配结果，否则同一个人会显示两张脸。
   */
  src?: string;
}

/**
 * 写实人物头像 —— B2B 工作台（专家名册 / 工作台头部 / 多专家协同弹窗）统一用它
 * 取代原来的 icon-park 图标，人物形象取自内置人物形象库（专家数字分身市场同源）。
 * 按 seed 稳定分配，刷新不变脸。
 */
const PersonAvatar: React.FC<PersonAvatarProps> = ({ seed, size, shape = 'circle', className, title, src }) => (
  <img
    src={src ?? pickPersonFigure(seed).src}
    alt={title ?? ''}
    title={title}
    draggable={false}
    style={{ width: size, height: size }}
    className={[shape === 'circle' ? 'rounded-full' : 'rd-10px', 'object-cover shrink-0', className]
      .filter(Boolean)
      .join(' ')}
  />
);

export default PersonAvatar;
