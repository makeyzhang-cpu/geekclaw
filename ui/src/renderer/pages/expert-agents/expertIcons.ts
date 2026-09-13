/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Balance,
  Brain,
  Bug,
  Calendar,
  Camera,
  ChartLine,
  CloudStorage,
  Code,
  Currency,
  Dashboard,
  Edit,
  FileText,
  Globe,
  Heart,
  HighLight,
  Histogram,
  International,
  Link,
  Mail,
  People,
  Pie,
  Report,
  Scan,
  Search,
  Setting,
  Speaker,
  Text,
  Trend,
  Translate,
  Video,
} from '@icon-park/react';

export type ExpertIconComp = React.ComponentType<{
  size?: number | string;
  theme?: 'outline' | 'filled' | 'two-tone' | 'multi-color';
  fill?: string;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}>;

/**
 * Shared expert identity/skill icon registry.
 *
 * `ExpertIdentity.icon` / `ExpertSkill.icon` hold an icon-park component *name*
 * (persisted as a plain string), so both the expert-agents hub and the B2B
 * trade desk need the same name → component table to render them.
 */
export const expertIconMap: Record<string, ExpertIconComp> = {
  Balance,
  Brain,
  Bug,
  Calendar,
  Camera,
  ChartLine,
  CloudStorage,
  Code,
  Currency,
  Dashboard,
  Edit,
  FileText,
  Globe,
  Heart,
  HighLight,
  Histogram,
  International,
  Link,
  Mail,
  People,
  Pie,
  Report,
  Scan,
  Search,
  Setting,
  Speaker,
  Text,
  Trend,
  Translate,
  Video,
};

export const resolveExpertIcon = (name: string): ExpertIconComp => expertIconMap[name] ?? People;

export const expertIconOptions = Object.keys(expertIconMap).map((key) => ({
  label: key,
  value: key,
}));
