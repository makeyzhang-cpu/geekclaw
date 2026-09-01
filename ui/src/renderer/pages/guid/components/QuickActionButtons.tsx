/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

type QuickActionButtonsProps = {
  onOpenBugReport: () => void;
  inactiveBorderColor: string;
  activeShadow: string;
};

/**
 * 快捷操作按钮组（反馈 / WebUI / 检查更新）已按产品要求移除。
 * 保留空壳组件以避免改动父组件 GuidPage 的引用。
 */
const QuickActionButtons: React.FC<QuickActionButtonsProps> = () => null;

export default QuickActionButtons;
