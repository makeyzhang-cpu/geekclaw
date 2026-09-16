/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

const readSource = (url: URL) => readFileSync(url, 'utf8');

describe('capability hub navigation', () => {
  test('uses compact Remote and Open labels for the Open Capabilities tab', () => {
    const zhSettings = JSON.parse(
      readSource(new URL('../../../services/i18n/locales/zh-CN/settings.json', import.meta.url))
    );
    const enSettings = JSON.parse(
      readSource(new URL('../../../services/i18n/locales/en-US/settings.json', import.meta.url))
    );

    expect(zhSettings.openCapabilities.title).toBe('远程&开放能力');
    expect(zhSettings.openCapabilities.railTitle).toBe('远程&开放能力');
    expect(enSettings.openCapabilities.title).toBe('Remote & Open');
    expect(enSettings.openCapabilities.railTitle).toBe('Remote & Open');
  });

  test('keeps skills / presets / MCP / scheduled on the rail; remote entries moved into settings', () => {
    const siderSource = readSource(new URL('./index.tsx', import.meta.url));

    expect(siderSource.includes('SiderSkillsEntry')).toBe(true);
    expect(siderSource.includes("navTo('/skills')")).toBe(true);
    expect(siderSource.includes("isActive={isRouteActive('/skills')}")).toBe(true);
    expect(siderSource.includes('SiderPresetEntry')).toBe(true);
    expect(siderSource.includes("navTo('/presets')")).toBe(true);
    expect(siderSource.includes("isActive={isRouteActive('/presets')}")).toBe(true);
    expect(siderSource.includes('SiderMcpEntry')).toBe(true);
    expect(siderSource.includes("navTo('/mcp')")).toBe(true);
    expect(siderSource.includes("isActive={isRouteActive('/mcp')}")).toBe(true);
    expect(siderSource.includes('SiderScheduledEntry')).toBe(true);
    expect(siderSource.includes("navTo('/scheduled')")).toBe(true);

    // 浏览器 / 远程&开放能力 / 模型管理 已统一收进
    // 【系统设置】→「应用」分组内的「远程主机」(ssh-hosts) 之下，不再占用主栏。
    expect(siderSource.includes('SiderModelHubEntry')).toBe(false);
    expect(siderSource.includes("navTo('/models')")).toBe(false);
    expect(siderSource.includes("navTo('/open-capabilities')")).toBe(false);

    expect(siderSource.includes('SiderExtensionsEntry')).toBe(false);
  });

  test('routes Open Capabilities and preserves MCP legacy destinations', () => {
    const routerSource = readSource(new URL('../Router.tsx', import.meta.url));

    expect(routerSource.includes("path='/open-capabilities'")).toBe(true);
    expect(routerSource.includes("path='/settings/webui' element={<Navigate to='/open-capabilities'")).toBe(true);
    expect(routerSource.includes("path='/settings/tools' element={<Navigate to='/open-capabilities'")).toBe(true);
    expect(routerSource.includes('getHashRouteRedirectUrl')).toBe(true);
    expect(routerSource.includes("return `${origin}/#${pathname}${search}`")).toBe(true);
    expect(routerSource.includes("path='/mcp'")).toBe(true);
    expect(routerSource.includes("path='/presets'")).toBe(true);
    expect(routerSource.includes("path='/skills'")).toBe(true);
    expect(routerSource.includes('LegacyExtensionsRedirect')).toBe(true);
    expect(routerSource.includes("path='/extensions'")).toBe(true);
  });

  /**
   * Regression: `/foreign-trade` is a plain string prefix of
   * `/foreign-trade-ops`, so a naive `pathname.startsWith(base)` highlighted
   * BOTH 业务工作台 and 跟单工作台 when only the latter was open (user report
   * 2026-09-16). Every rail entry must go through the segment-safe helper.
   */
  test('rail entries match routes on segment boundaries, not raw prefixes', () => {
    const siderSource = readSource(new URL('./index.tsx', import.meta.url));

    // No entry may test a bare path prefix any more — sibling routes such as
    // /foreign-trade vs /foreign-trade-ops would collide.
    const barePrefixTests = siderSource.match(/isActive=\{pathname\.startsWith\('\/[A-Za-z0-9_-]+'\)\}/g) ?? [];
    expect(barePrefixTests).toEqual([]);

    // The two longest-prefix siblings must both be present and distinct.
    expect(siderSource.includes("isActive={isRouteActive('/foreign-trade')}")).toBe(true);
    expect(siderSource.includes("isActive={isRouteActive('/foreign-trade-ops')}")).toBe(true);

    // Sanity-check the helper's own semantics (exact match OR a '/' boundary).
    const within = (pathname: string, base: string) =>
      pathname === base || pathname.startsWith(`${base}/`);
    expect(within('/foreign-trade-ops', '/foreign-trade')).toBe(false);
    expect(within('/foreign-trade', '/foreign-trade')).toBe(true);
    expect(within('/foreign-trade/x', '/foreign-trade')).toBe(true);
    expect(within('/customer-service/roster', '/customer-service')).toBe(true);
    expect(within('/trade-knowledge', '/knowledge')).toBe(false);
  });
});
