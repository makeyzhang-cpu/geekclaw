/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAgentLogo } from '@/renderer/utils/model/agentLogo';
import { iconColors } from '@/renderer/styles/colors';
import GeekClawLogo from '@/renderer/assets/logos/brand/geekclaw-claw.png';
import { Robot } from '@icon-park/react';
import React from 'react';
import type { PresetReference } from '@/common/types/agent/presetTypes';

export type AgentBadgeProps = {
  /** Agent backend type */
  backend?: string;
  /** Display name for the agent */
  agent_name?: string;
  /** Custom agent logo (SVG path or emoji string) */
  agentLogo?: string;
  /** Whether the logo is an emoji */
  agentLogoIsEmoji?: boolean;
  /** Preset lineage for callers that expose configuration details. */
  presetId?: PresetReference;
};

/**
 * Render the conversation/agent brand icon.
 *
 * Brand consistency policy: this is a single-brand product (GeekClaw), so the
 * identity icon for every agent surface — conversation header, mobile brand
 * bar, agent mode selector, search popover, etc. — must always be the
 * GeekClaw red-circle white-claw logo, regardless of whether the underlying
 * preset supplies a custom logo (emoji or image), a backend-specific logo, or
 * no logo at all. Any other icon (the @icon-park Robot, a custom preset image
 * like the legacy mochi pink-bowl asset, a backend-specific brand mark, …)
 * is a brand leak and is replaced here.
 */
export const AgentLogoIcon: React.FC<
  Pick<AgentBadgeProps, 'backend' | 'agentLogo' | 'agentLogoIsEmoji' | 'agent_name'>
> = () => {
  return (
    <span className='inline-flex w-16px h-16px items-center justify-center shrink-0 leading-none'>
      <img src={GeekClawLogo} alt='GeekClaw' className='block w-16px h-16px object-contain' />
    </span>
  );
};
