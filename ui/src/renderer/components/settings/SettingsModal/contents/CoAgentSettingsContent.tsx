/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * 协同共答（co-agent）设置：梯度开关 UI。
 *
 * 让用户在「智能体」设置页配置协作者的参与模式（关闭 / 手动 / 关键词 /
 * 自动），以及触发关键词、协作者名称、可选显式模型。配置持久化到
 * `configKey coAgent.config`，随 `POST /api/co-agent/run` 下发，后端无 DB 迁移。
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Radio, Typography } from '@arco-design/web-react';
import PreferenceRow from './SystemModalContent/PreferenceRow';
import { useConfig } from '@/renderer/hooks/config/useConfig';
import {
  DEFAULT_CO_AGENT_CONFIG,
  type ICoAgentConfig,
  type ICoAgentMode,
} from '@/common/types/coAgent';

const { Paragraph, Text } = Typography;

const MODE_OPTIONS: { value: ICoAgentMode; labelKey: string; descKey: string }[] = [
  { value: 'off', labelKey: 'settings.coAgent.modeOff', descKey: 'settings.coAgent.modeOffDesc' },
  { value: 'manual', labelKey: 'settings.coAgent.modeManual', descKey: 'settings.coAgent.modeManualDesc' },
  { value: 'keyword', labelKey: 'settings.coAgent.modeKeyword', descKey: 'settings.coAgent.modeKeywordDesc' },
  { value: 'auto', labelKey: 'settings.coAgent.modeAuto', descKey: 'settings.coAgent.modeAutoDesc' },
];

/** 把关键词文本（逗号/换行分隔）解析为去空白非空数组。 */
const parseKeywords = (text: string): string[] =>
  text
    .split(/[\n,]/)
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

const keywordsToText = (keywords: string[]): string => (keywords ?? []).join('\n');

const CoAgentSettingsContent: React.FC = () => {
  const { t } = useTranslation();
  const [stored, setStored] = useConfig('coAgent.config');

  const config: ICoAgentConfig = useMemo(
    () => ({ ...DEFAULT_CO_AGENT_CONFIG, ...(stored ?? {}) }),
    [stored]
  );

  const update = (patch: Partial<ICoAgentConfig>) => {
    void setStored({ ...config, ...patch });
  };

  return (
    <div className='flex flex-col gap-16px'>
      <Paragraph className='text-12px leading-18px text-t-secondary mb-0'>
        {t('settings.coAgent.desc')}
      </Paragraph>

      <PreferenceRow
        label={t('settings.coAgent.mode')}
        description={t('settings.coAgent.modeDesc')}
      >
        <Radio.Group
          type='button'
          value={config.mode}
          onChange={(value) => update({ mode: value as ICoAgentMode })}
        >
          {MODE_OPTIONS.map((opt) => (
            <Radio key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </Radio>
          ))}
        </Radio.Group>
        <Text className='block text-12px text-t-secondary mt-8px'>
          {t(MODE_OPTIONS.find((o) => o.value === config.mode)?.descKey ?? 'settings.coAgent.modeAutoDesc')}
        </Text>
      </PreferenceRow>

      {config.mode === 'keyword' && (
        <PreferenceRow
          label={t('settings.coAgent.keywords')}
          description={t('settings.coAgent.modeKeywordDesc')}
        >
          <Input.TextArea
            autoSize={{ minRows: 2, maxRows: 4 }}
            value={keywordsToText(config.keywords)}
            placeholder={t('settings.coAgent.keywordsPlaceholder')}
            onChange={(text) => update({ keywords: parseKeywords(text) })}
          />
        </PreferenceRow>
      )}

      <PreferenceRow label={t('settings.coAgent.name')} description={undefined}>
        <Input
          style={{ maxWidth: 280 }}
          value={config.name}
          placeholder={t('settings.coAgent.namePlaceholder')}
          onChange={(value) => update({ name: value })}
        />
      </PreferenceRow>

      <PreferenceRow label={t('settings.coAgent.advanced')} description={undefined}>
        <div className='flex flex-col gap-10px'>
          <Input
            style={{ maxWidth: 320 }}
            value={config.provider_id}
            placeholder='provider_id（留空 = 系统默认）'
            onChange={(value) => update({ provider_id: value })}
          />
          <Input
            style={{ maxWidth: 320 }}
            value={config.model}
            placeholder='model（留空 = 系统默认）'
            onChange={(value) => update({ model: value })}
          />
          <Text className='text-12px text-t-secondary'>
            {t('settings.coAgent.providerModelDesc')}
          </Text>
        </div>
      </PreferenceRow>
    </div>
  );
};

export default CoAgentSettingsContent;
