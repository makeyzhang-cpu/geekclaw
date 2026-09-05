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

/** Render agent logo from custom logo, backend logo, or fallback Robot icon */
export const AgentLogoIcon: React.FC<
  Pick<AgentBadgeProps, 'backend' | 'agentLogo' | 'agentLogoIsEmoji' | 'agent_name'>
> = ({ backend, agentLogo, agentLogoIsEmoji, agent_name }) => {
  const logoContent = (() => {
    if (agentLogo) {
      // Brand consistency: never render a user-supplied emoji as the agent
      // identity icon. Fallback to the GeekClaw red-circle white-claw logo so
      // every conversation surface uses one recognisable mark.
      if (agentLogoIsEmoji) {
        return <img src={GeekClawLogo} alt='GeekClaw' className='block w-16px h-16px object-contain' />;
      }
      return (
        <img src={agentLogo} alt={`${agent_name || 'agent'} logo`} className='block w-16px h-16px object-contain' />
      );
    }
    const logo = getAgentLogo(backend);
    if (logo) {
      return <img src={logo} alt={`${backend} logo`} className='block w-16px h-16px object-contain' />;
    }
    return <Robot theme='outline' size={16} fill={iconColors.primary} />;
  })();

  return (
    <span className='inline-flex w-16px h-16px items-center justify-center shrink-0 leading-none'>{logoContent}</span>
  );
};
