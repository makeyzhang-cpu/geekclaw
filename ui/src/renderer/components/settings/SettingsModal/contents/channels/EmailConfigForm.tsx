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

interface EmailConfigFormProps {
  pluginStatus: IChannelPluginStatus | null;
  channelTarget?: ChannelTarget;
  onStatusChange: (status: IChannelPluginStatus | null) => void;
}

const EMAIL_DOCS_URL = 'https://support.google.com/mail/answer/7126229';

const EmailConfigForm: React.FC<EmailConfigFormProps> = ({
  pluginStatus,
  channelTarget,
  onStatusChange,
}) => {
  const { t } = useTranslation();
  const [accountId, setAccountId] = useState('');
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('');
  const [imapUsername, setImapUsername] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSaveAndEnable = async () => {
    const addr = accountId.trim();
    const user = imapUsername.trim() || addr;
    const pw = imapPassword.trim();
    if (!addr || !pw) {
      Message.warning(
        t('settings.email.credentialsRequired', 'Email address and password are required'),
      );
      return;
    }
    setSaving(true);
    try {
      const config = {
        credentials: {
          account_id: addr,
          imap_username: user,
          imap_password: pw,
          imap_host: imapHost.trim() || undefined,
          imap_port: imapPort ? Number(imapPort) : undefined,
          smtp_host: smtpHost.trim() || undefined,
          smtp_port: smtpPort ? Number(smtpPort) : undefined,
        },
      };
      const result = await channel.enablePlugin.invoke(
        buildEnablePluginRequest('email', channelTarget, config),
      );
      if (!result.success) {
        throw new Error(
          result.error ||
            t('geekclaw.settings.remoteEnableFailed', {
              defaultValue: 'Failed to enable channel',
            }),
        );
      }
      Message.success(t('settings.email.pluginEnabled', 'Email channel enabled (SMTP send active)'));
      const plugins = await channel.getPluginStatus.invoke();
      if (plugins) {
        const plugin = findEnabledChannelStatus(plugins, {
          platform: 'email',
          enabledPluginId: result.plugin_id,
          companionId: channelTarget?.companionId,
          ownerDomain: channelTarget?.ownerDomain,
        });
        onStatusChange(plugin || null);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[EmailConfig] Save failed:', error);
      Message.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='flex flex-col gap-24px'>
      <div className='text-12px leading-relaxed p-10px rd-8px bg-[rgba(var(--orange-6),0.08)] border border-solid border-[rgba(var(--orange-6),0.3)] text-t-secondary'>
        <div className='font-500 text-t-primary mb-6px'>
          {t('settings.email.scopeTitle', 'Email channel — SMTP send (v1)')}
        </div>
        <div className='mt-6px'>
          {t(
            'settings.email.scopeHint',
            'SMTP outbound is active in v5.0.26. IMAP IDLE polling is scheduled for 5.0.27 — configure your account now to test outbound replies.',
          )}
        </div>
        <div className='mt-4px'>
          <a
            className='text-primary hover:underline cursor-pointer text-12px'
            href={EMAIL_DOCS_URL}
            onClick={(e) => {
              e.preventDefault();
              openExternalUrl(EMAIL_DOCS_URL).catch(console.error);
            }}
          >
            {t('settings.email.devDocLink', 'IMAP/SMTP app password guide (Gmail)')}
          </a>
        </div>
      </div>

      <PreferenceRow
        label={t('settings.email.accountId', 'From Address')}
        description={t(
          'settings.email.accountIdDesc',
          'The email address messages will appear to come from (also used as the bot identity).',
        )}
        required
      >
        <Input
          value={accountId}
          onChange={setAccountId}
          placeholder={pluginStatus?.hasToken ? '••••••••••••••••' : 'agent@example.com'}
          style={{ width: 280 }}
          disabled={!!pluginStatus?.connected}
        />
      </PreferenceRow>

      <PreferenceRow
        label={t('settings.email.imapUsername', 'IMAP / SMTP Username')}
        description={t(
          'settings.email.imapUsernameDesc',
          'Defaults to the From Address if blank. For Gmail, use the full address; for Outlook/QQ, often the same.',
        )}
      >
        <Input
          value={imapUsername}
          onChange={setImapUsername}
          style={{ width: 280 }}
          disabled={!!pluginStatus?.connected}
        />
      </PreferenceRow>

      <PreferenceRow
        label={t('settings.email.imapPassword', 'App Password')}
        description={t(
          'settings.email.imapPasswordDesc',
          'App-specific password (Gmail / Outlook / QQ). NEVER your account login password.',
        )}
        required
      >
        <Input.Password
          value={imapPassword}
          onChange={setImapPassword}
          placeholder={pluginStatus?.hasToken ? '••••••••••••••••' : ''}
          style={{ width: 280 }}
          disabled={!!pluginStatus?.connected}
        />
      </PreferenceRow>

      <PreferenceRow
        label={t('settings.email.imapHost', 'IMAP Host')}
        description={t(
          'settings.email.imapHostDesc',
          'Auto-resolved for gmail/outlook/qq/163/126 addresses when blank.',
        )}
      >
        <Input
          value={imapHost}
          onChange={setImapHost}
          placeholder="imap.gmail.com"
          style={{ width: 280 }}
          disabled={!!pluginStatus?.connected}
        />
      </PreferenceRow>

      <PreferenceRow
        label={t('settings.email.smtpHost', 'SMTP Host')}
        description={t(
          'settings.email.smtpHostDesc',
          'Auto-resolved for gmail/outlook/qq/163/126 addresses when blank.',
        )}
      >
        <Input
          value={smtpHost}
          onChange={setSmtpHost}
          placeholder="smtp.gmail.com"
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
            ? t('settings.email.alreadyEnabled', 'Already enabled')
            : t('settings.email.saveAndEnable', 'Save & enable (SMTP only)')}
        </Button>
      </div>
    </div>
  );
};

export default EmailConfigForm;
