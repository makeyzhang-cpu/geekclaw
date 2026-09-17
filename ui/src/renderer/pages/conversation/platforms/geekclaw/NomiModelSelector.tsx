/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IModelSuggestion } from '@/common/config/storage';
import type { NomiModelSelection } from './useNomiModelSelection';
import { compositeKey } from '@/common/utils/compositeKey';
import { usePreviewContextOptional } from '@/renderer/pages/conversation/Preview';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { getModelDisplayLabel } from '@/renderer/utils/model/agentLogo';
import { iconColors } from '@/renderer/styles/colors';
import { Button, Dropdown, Menu } from '@arco-design/web-react';
import { Brain, Down } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { useModelSelectorProviderLabel } from '@/renderer/hooks/agent/useModelSelectorProviderLabel';

const NomiModelSelector: React.FC<{
  selection?: NomiModelSelection;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}> = ({ selection, disabled = false, compact: compactProp, className }) => {
  const { t } = useTranslation();
  // 非抛错版：会话栏（TeamHero）等**还没有会话行、因此没有 PreviewProvider**
  // 的表面也要渲染本选择器（开局选模型）。缺 provider 时当作「预览已关」。
  const preview = usePreviewContextOptional();
  const isPreviewOpen = preview?.isOpen ?? false;
  const layout = useLayoutContext();
  const compact = compactProp ?? (isPreviewOpen || layout?.isMobile);
  const isMobileHeaderCompact = Boolean(layout?.isMobile);
  const defaultModelLabel = t('common.defaultModel');
  const providerLabel = useModelSelectorProviderLabel();

  const current_model = selection?.current_model;
  const suggestion: IModelSuggestion | null = selection?.modelSuggestion ?? null;

  const renderLogo = () => <Brain theme='outline' size='14' fill={iconColors.secondary} className='shrink-0' />;

  const renderControl = () => {
    if (disabled || !selection) {
      return (
        <Button
          className={classNames(
            'sendbox-model-btn header-model-btn min-w-0',
            compact ? '!max-w-[120px]' : '!max-w-[280px]',
            isMobileHeaderCompact && '!max-w-[160px]',
            className
          )}
          shape='round'
          size='small'
          style={{ cursor: 'default' }}
          aria-label={t('conversation.welcome.useCliModel')}
        >
          <span className='flex items-center gap-6px min-w-0'>
            {renderLogo()}
            <span className='sendbox-responsive-label block truncate min-w-0'>
              {t('conversation.welcome.useCliModel')}
            </span>
          </span>
        </Button>
      );
    }

    const { providers, getAvailableModels, handleSelectModel } = selection;

    const label = getModelDisplayLabel({
      selected_value: current_model?.use_model,
      selectedLabel: current_model?.use_model || '',
      defaultModelLabel,
      fallbackLabel: t('conversation.welcome.selectModel'),
    });

    return (
      <Dropdown
        trigger='click'
        // Mobile: portal the popup to <body> so it escapes the titlebar slot.
        // Desktop: leave default container so click events reach Menu.Item normally.
        {...(isMobileHeaderCompact ? { getPopupContainer: () => document.body } : {})}
        droplist={
          <Menu>
            {providers.map((provider) => {
              const models = getAvailableModels(provider);
              if (!models.length) return null;

              return (
                <Menu.ItemGroup title={providerLabel(provider)} key={provider.id}>
                  {models.map((modelName) => (
                    <Menu.Item
                      key={compositeKey(provider.id, modelName)}
                      data-testid={`geekclaw-model-option-${modelName}`}
                      className={current_model?.id === provider.id && current_model?.use_model === modelName ? '!bg-2' : ''}
                      onClick={() => void handleSelectModel(provider, modelName)}
                    >
                      <div className='flex items-center gap-8px w-full'>
                        <span>{modelName}</span>
                      </div>
                    </Menu.Item>
                  ))}
                </Menu.ItemGroup>
              );
            })}
          </Menu>
        }
      >
        <Button
          data-testid='geekclaw-model-selector'
          className={classNames(
            'sendbox-model-btn header-model-btn min-w-0',
            compact ? '!max-w-[120px]' : '!max-w-[280px]',
            isMobileHeaderCompact && '!max-w-[160px]',
            className
          )}
          shape='round'
          size='small'
          aria-label={label}
        >
          <span className='flex items-center gap-6px min-w-0'>
            {renderLogo()}
            <span className='sendbox-responsive-label block truncate min-w-0'>{label}</span>
            <Down
              theme='outline'
              size={12}
              fill={iconColors.secondary}
              className='sendbox-responsive-chevron shrink-0'
            />
          </span>
        </Button>
      </Dropdown>
    );
  };

  // No staged AI suggestion → just the selector.
  if (!suggestion) {
    return renderControl();
  }

  // A model swap is staged: float a compact "🤖 AI 推荐" chip above the
  // selector so it never disrupts the sendbox's inline flex row. The chip is
  // positioned above and to the left of the button (bottom-full / left-0).
  const providerName = (() => {
    const provider = selection?.providers.find((p) => p.id === suggestion.provider_id);
    return provider ? providerLabel(provider) : suggestion.provider_id;
  })();

  return (
    <div className='relative inline-flex'>
      {renderControl()}
      <div
        data-testid='geekclaw-model-suggestion'
        className='absolute bottom-full left-0 mb-2 z-50 flex items-center gap-6px flex-wrap max-w-340px rounded-8px px-8px py-6px shadow-md'
        style={{ background: 'rgb(var(--gray-2))', border: '1px solid rgb(var(--geekclaw-6))' }}
      >
        <span className='text-11px leading-tight shrink-0' style={{ color: 'rgb(var(--geekclaw-6))' }}>
          🤖 {t('geekclaw.chat.modelSuggestion')}
        </span>
        <span className='text-11px text-t-secondary'>
          {t('geekclaw.chat.modelSuggestionBody', {
            provider: providerName,
            model: suggestion.model,
            reason: suggestion.reason,
          })}
        </span>
        <button
          type='button'
          className='px-8px py-2px rd-4px text-11px cursor-pointer border-none'
          style={{ background: 'rgb(var(--geekclaw-6))', color: '#fff' }}
          onClick={() => void selection?.onAdoptModelSuggestion?.(suggestion)}
        >
          {t('geekclaw.chat.modelSuggestionAdopt')}
        </button>
        <button
          type='button'
          className='px-8px py-2px rd-4px text-11px cursor-pointer'
          style={{ background: 'transparent', color: 'rgb(var(--gray-6))', border: '1px solid rgb(var(--gray-4))' }}
          onClick={() => void selection?.onDismissModelSuggestion?.()}
        >
          {t('geekclaw.chat.modelSuggestionIgnore')}
        </button>
      </div>
    </div>
  );
};

export default NomiModelSelector;
