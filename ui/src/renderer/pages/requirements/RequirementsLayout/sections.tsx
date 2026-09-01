/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Shop, ShoppingBag } from '@icon-park/react';

/** The two top-level sections of the A2A cross-border e-commerce shell. */
export type RequirementsSection = 'workspace' | 'storefront';

export interface RequirementsSectionDef {
  key: RequirementsSection;
  /** Localized rail label. */
  label: string;
  /** Rail icon. */
  icon: React.ReactNode;
  /** Absolute route path the rail item navigates to. */
  path: string;
}

/**
 * The A2A cross-border e-commerce section definitions, in rail order.
 *
 * Each section is a real nested route under `/requirements`, so `path` is an
 * absolute pathname (the shell rail navigates to it and derives the active
 * section from the current location). `workspace` is the index route, so its
 * path is the bare `/requirements`.
 */
export const useRequirementsSections = (): RequirementsSectionDef[] => {
  const { t } = useTranslation();
  return [
    {
      key: 'workspace',
      label: t('requirements.section.workspace'),
      icon: <ShoppingBag theme='outline' size='16' strokeWidth={3} />,
      path: '/requirements',
    },
    {
      key: 'storefront',
      label: t('requirements.section.storefront'),
      icon: <Shop theme='outline' size='16' strokeWidth={3} />,
      path: '/requirements/storefront',
    },
  ];
};
