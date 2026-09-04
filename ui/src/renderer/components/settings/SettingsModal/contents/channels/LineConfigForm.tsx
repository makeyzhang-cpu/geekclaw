/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IChannelPluginStatus } from '@/common/types/channel/channel';
import { channel } from '@/common/adapter/ipcBridge';
import { openExternalUrl } from '@/renderer/utils/platform';
import { Button, Input, Message } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildEnablePluginRequest, findEnabledChannelStatus } from '@/renderer/components/channels/channelStatusSelection';
import type { ChannelTarget } from './channelTarget';

const PreferenceRow: React.FC<{
  label: string;
  description?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
}> = ({ label, description, required, children }) => (
  <div className='flex items-center justify-between gap-24px py-12px'>
    <div className='flex-1'>
      <div className='flex items-center gap-8px'>
        <span className='text-14px text-t-primary'>
          {label}
          {required && <span className='text-red-500 ml-2px'>*</span>}
        </span>
      </div>
      {description && <div className='text-12px text-t-tertiary mt-2px'>{description}</div>}
    </div>
    <div className='flex items-center'>{children}</div>
  </div>
);

interface LineConfigFormProps {
  pluginStatus: IChannelPluginStatus | null;
  channelTarget?: ChannelTarget;
  onStatusChange: (status: IChannelPluginStatus | null) => void;
}

const LINE_DOCS_URL = 'https://developers.line.biz/en/docs/messaging-api/building-bot/';

const LineConfigForm: React.FC<LineConfigFormProps> = ({
  pluginStatus,
  channelTarget,
  onStatusChange,
}) => {
  const { t } = useTranslation();
  const [channelId, setChannelId] = useState('');
  const [channelAccessToken, setChannelAccessToken] = useState('');
  const [channelSecret, setChannelSecret] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSaveAndEnable = async () => {
    const id = channelId.trim();
    const token = channelAccessToken.trim();
    if (!id || !token) {
      Message.warning(
        t('settings.line.credentialsRequired', 'Channel ID and Channel Access Token are required'),
      );
      return;
    }
    setSaving(true);
    try {
      const config = {
        credentials: {
          channel_id: id,
          channel_access_token: token,
          channel_secret: channelSecret.trim() || undefined,
        },
      };
      const result = await channel.enablePlugin.invoke(
        buildEnablePluginRequest('line', channelTarget, config),
      );
      if (!result.success) {
        throw new Error(
          result.error ||
            t('geekclaw.settings.remoteEnableFailed', {
              defaultValue: 'Failed to enable channel',
            }),
        );
      }
      Message.success(t('settings.line.pluginEnabled', 'LINE channel enabled'));
      const plugins = await channel.getPluginStatus.invoke();
      if (plugins) {
        const plugin = findEnabledChannelStatus(plugins, {
          platform: 'line',
          enabledPluginId: result.plugin_id,
          companionId: channelTarget?.companionId,
          ownerDomain: channelTarget?.ownerDomain,
        });
        onStatusChange(plugin || null);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[LineConfig] Save failed:', error);
      Message.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='flex flex-col gap-24px'>
      <div className='text-12px leading-relaxed p-10px rd-8px bg-[rgba(var(--orange-6),0.08)] border border-solid border-[rgba(var(--orange-6),0.3)] text-t-secondary'>
        <div className='font-500 text-t-primary mb-6px'>
          {t('settings.line.webhookTitle', 'LINE Messaging API — webhook mode')}
        </div>
        <div className='mt-6px'>
          {t(
            'settings.line.webhookHint',
            'Configure a webhook URL in LINE Official Account Manager pointing to /api/channel/plugins/line/webhook. GeekClaw verifies the X-Line-Signature HMAC.',
          )}
        </div>
        <div className='mt-4px'>
          <a
            className='text-primary hover:underline cursor-pointer text-12px'
            href={LINE_DOCS_URL}
            onClick={(e) => {
              e.preventDefault();
              openExternalUrl(LINE_DOCS_URL).catch(console.error);
            }}
          >
            {t('settings.line.devDocLink', 'LINE Messaging API — building a bot')}
          </a>
        </div>
      </div>

      <PreferenceRow
        label={t('settings.line.channelId', 'Channel ID')}
        description={t(
          'settings.line.channelIdDesc',
          'Numeric channel ID from LINE Official Account Manager → Messaging API.',
        )}
        required
      >
        <Input
          value={channelId}
          onChange={setChannelId}
          placeholder={pluginStatus?.hasToken ? '••••••••••••••••' : ''}
          style={{ width: 280 }}
          disabled={!!pluginStatus?.connected}
        />
      </PreferenceRow>

      <PreferenceRow
        label={t('settings.line.channelAccessToken', 'Channel Access Token')}
        description={t(
          'settings.line.channelAccessTokenDesc',
          'Long-lived token issued by LINE (Messaging API → Channel access token).',
        )}
        required
      >
        <Input.Password
          value={channelAccessToken}
          onChange={setChannelAccessToken}
          placeholder={pluginStatus?.hasToken ? '••••••••••••••••' : ''}
          style={{ width: 280 }}
          disabled={!!pluginStatus?.connected}
        />
      </PreferenceRow>

      <PreferenceRow
        label={t('settings.line.channelSecret', 'Channel Secret')}
        description={t(
          'settings.line.channelSecretDesc',
          'Used to verify the X-Line-Signature HMAC on incoming webhooks.',
        )}
      >
        <Input.Password
          value={channelSecret}
          onChange={setChannelSecret}
          style={{ width: 280 }}
          disabled={!!pluginStatus?.connected}
        />
      </PreferenceRow>

      <div className='flex justify-end pt-8px'>
        <Button
          type='primary'
          loading={saving}
          onClick={() => void handleSaveAndEnable()}
          disabled={!!pluginStatus?.connected}
        >
          {pluginStatus?.connected
            ? t('settings.line.alreadyEnabled', 'Already enabled')
            : t('settings.line.saveAndEnable', 'Save & enable')}
        </Button>
      </div>
    </div>
  );
};

export default LineConfigForm;
