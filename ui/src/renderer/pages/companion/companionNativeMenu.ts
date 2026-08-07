/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type CompanionMenuAction = 'open-chat' | 'open-memories' | 'open-config' | 'hide';

export interface CompanionMenuEntry {
  action: CompanionMenuAction;
  text: string;
}

type Translate = (key: string, params?: Record<string, string>) => string;

export function buildCompanionMenuEntries(opts: { name: string; t: Translate }): CompanionMenuEntry[] {
  return [
    { action: 'open-chat', text: opts.t('geekclaw.companion.menuOpenChat') },
    { action: 'open-memories', text: opts.t('geekclaw.companion.menuOpenMemories') },
    { action: 'open-config', text: opts.t('geekclaw.companion.menuOpenConfig', { name: opts.name }) },
    { action: 'hide', text: opts.t('geekclaw.companion.menuHide') },
  ];
}
