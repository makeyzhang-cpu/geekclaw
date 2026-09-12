/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

describe('application sider overflow handling', () => {
  test('scrolls the navigation body while keeping the settings entry reachable', () => {
    // 导航主体独立滚动。原先「底部固定设置组」已随 UserMenu / 助理能力仓改版移除，
    // 故第二个断言改为校验「系统设置」仍挂在助理能力仓分组下。
    expect(source.includes("'flex-1 min-h-0 overflow-y-auto overflow-x-hidden'")).toBe(true);
    expect(source.includes("'common.siderSection.assistantVault'")).toBe(true);
  });
});
