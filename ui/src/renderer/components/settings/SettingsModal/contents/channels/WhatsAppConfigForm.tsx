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

interface WhatsAppConfigFormProps {
  pluginStatus: IChannelPluginStatus | null;
  channelTarget?: ChannelTarget;
  onStatusChange: (status: IChannelPluginStatus | null) => void;
}

const WA_DOCS_URL = 'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started';

const WhatsAppConfigForm: React.FC<WhatsAppConfigFormProps> = ({
  pluginStatus,
  channelTarget,
  onStatusChange,
}) => {
  const { t } = useTranslation();
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSaveAndEnable = async () => {
    const phoneId = phoneNumberId.trim();
    const token = accessToken.trim();
    if (!phoneId || !token) {
      Message.warning(
        t('settings.whatsapp.credentialsRequired', 'Phone Number ID and Access Token are required'),
      );
      return;
    }
    setSaving(true);
    try {
      const config = {
        credentials: {
          phone_number_id: phoneId,
          whatsapp_access_token: token,
          verify_token: verifyToken.trim() || undefined,
          whatsapp_app_secret: appSecret.trim() || undefined,
        },
      };
      const result = await channel.enablePlugin.invoke(
        buildEnablePluginRequest('whatsapp', channelTarget, config),
      );
      if (!result.success) {
        throw new Error(
          result.error ||
            t('geekclaw.settings.remoteEnableFailed', {
              defaultValue: 'Failed to enable channel',
            }),
        );
      }
      Message.success(t('settings.whatsapp.pluginEnabled', 'WhatsApp channel enabled'));
      const plugins = await channel.getPluginStatus.invoke();
      if (plugins) {
        const plugin = findEnabledChannelStatus(plugins, {
          platform: 'whatsapp',
          enabledPluginId: result.plugin_id,
          companionId: channelTarget?.companionId,
          ownerDomain: channelTarget?.ownerDomain,
        });
        onStatusChange(plugin || null);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[WhatsAppConfig] Save failed:', error);
      Message.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='flex flex-col gap-24px'>
      <div className='text-12px leading-relaxed p-10px rd-8px bg-[rgba(var(--orange-6),0.08)] border border-solid border-[rgba(var(--orange-6),0.3)] text-t-secondary'>
        <div className='font-500 text-t-primary mb-6px'>
          {t('settings.whatsapp.webhookTitle', 'WhatsApp Cloud API — webhook mode')}
        </div>
        <div className='mt-6px'>
          {t(
            'settings.whatsapp.webhookHint',
            'Configure a webhook in Meta Business Suite pointing to /api/channel/plugins/whatsapp/webhook. GeekClaw verifies the X-Hub-Signature-256 header.',
          )}
        </div>
        <div className='mt-4px'>
          <a
            className='text-primary hover:underline cursor-pointer text-12px'
            href={WA_DOCS_URL}
            onClick={(e) => {
              e.preventDefault();
              openExternalUrl(WA_DOCS_URL).catch(console.error);
            }}
          >
            {t('settings.whatsapp.devDocLink', 'WhatsApp Cloud API quickstart')}
          </a>
        </div>
      </div>

      <PreferenceRow
        label={t('settings.whatsapp.phoneNumberId', 'Phone Number ID')}
        description={t(
          'settings.whatsapp.phoneNumberIdDesc',
          'Numeric phone-number ID from Meta Business Suite (the non-secret bot identity).',
        )}
        required
      >
        <Input
          value={phoneNumberId}
          onChange={setPhoneNumberId}
          placeholder={pluginStatus?.hasToken ? '••••••••••••••••' : ''}
          style={{ width: 280 }}
          disabled={!!pluginStatus?.connected}
        />
      </PreferenceRow>

      <PreferenceRow
        label={t('settings.whatsapp.accessToken', 'Access Token')}
        description={t(
          'settings.whatsapp.accessTokenDesc',
          'Permanent access token (starts with EAA…).',
        )}
        required
      >
        <Input.Password
          value={accessToken}
          onChange={setAccessToken}
          placeholder={pluginStatus?.hasToken ? '••••••••••••••••' : ''}
          style={{ width: 280 }}
          disabled={!!pluginStatus?.connected}
        />
      </PreferenceRow>

      <PreferenceRow
        label={t('settings.whatsapp.verifyToken', 'Verify Token')}
        description={t(
          'settings.whatsapp.verifyTokenDesc',
          'Echoed back to Meta when verifying the webhook (GET ?hub.challenge).',
        )}
      >
        <Input
          value={verifyToken}
          onChange={setVerifyToken}
          style={{ width: 280 }}
          disabled={!!pluginStatus?.connected}
        />
      </PreferenceRow>

      <PreferenceRow
        label={t('settings.whatsapp.appSecret', 'App Secret')}
        description={t(
          'settings.whatsapp.appSecretDesc',
          'Used to verify the X-Hub-Signature-256 HMAC on incoming webhooks.',
        )}
      >
        <Input.Password
          value={appSecret}
          onChange={setAppSecret}
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
            ? t('settings.whatsapp.alreadyEnabled', 'Already enabled')
            : t('settings.whatsapp.saveAndEnable', 'Save & enable')}
        </Button>
      </div>
    </div>
  );
};

export default WhatsAppConfigForm;
