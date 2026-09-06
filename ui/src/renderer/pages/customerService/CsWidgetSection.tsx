/**
 * 网页挂件配置（客服详情页内嵌区块）。
 *
 * 这是"让 AI 客服能被官网访客触达"的开关：开一次拿到站点标识，复制一行
 * <script> 到客户官网即可。站点标识是官网侧唯一的公开凭据，所以提供轮换
 * 与吊销；来源白名单用来防止别人把你的客服挂到自己的网站上。
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Message, Popconfirm, Space, Switch, Tag } from '@arco-design/web-react';
import { Copy, Link, Refresh } from '@icon-park/react';

import { useCsWidgetConfig } from './useCsAgents';
import type { CsAgentId } from '@/common/types/ids';

/** 挂件脚本的默认服务地址（云端）。私有化部署时可改。 */
const DEFAULT_WIDGET_HOST = 'https://www.geekclaw.ai';

const CsWidgetSection: React.FC<{ csAgentId: CsAgentId }> = ({ csAgentId }) => {
  const { t } = useTranslation();
  const { config, loading, update } = useCsWidgetConfig(csAgentId);
  const [host, setHost] = useState(DEFAULT_WIDGET_HOST);
  const [originDraft, setOriginDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const embedCode = useMemo(() => {
    if (!config?.widget_key) return '';
    const base = host.trim().replace(/\/+$/, '');
    return `<script src="${base}/widget.js" data-key="${config.widget_key}"></script>`;
  }, [config?.widget_key, host]);

  const copy = async (text: string, okMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      Message.success(okMessage);
    } catch {
      Message.error(
        t('customerService.widget.copyFailed', { defaultValue: '复制失败，请手动选中复制' })
      );
    }
  };

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    const next = await update({ enabled });
    setBusy(false);
    if (next) {
      Message.success(
        enabled
          ? t('customerService.widget.enabledToast', { defaultValue: '网页挂件已启用' })
          : t('customerService.widget.disabledToast', { defaultValue: '网页挂件已停用' })
      );
    } else {
      Message.error(t('customerService.widget.saveFailed', { defaultValue: '保存失败，请重试' }));
    }
  };

  const rotateKey = async () => {
    setBusy(true);
    const next = await update({ rotate_key: true });
    setBusy(false);
    if (next) {
      Message.success(
        t('customerService.widget.rotatedToast', { defaultValue: '站点标识已重新生成，旧代码立即失效' })
      );
    } else {
      Message.error(t('customerService.widget.saveFailed', { defaultValue: '保存失败，请重试' }));
    }
  };

  const addOrigin = async () => {
    const value = originDraft.trim();
    if (!value) return;
    if (!/^https?:\/\//i.test(value)) {
      Message.warning(
        t('customerService.widget.originFormat', {
          defaultValue: '来源地址需以 http:// 或 https:// 开头',
        })
      );
      return;
    }
    const current = config?.allowed_origins ?? [];
    if (current.includes(value)) {
      setOriginDraft('');
      return;
    }
    setBusy(true);
    const next = await update({ allowed_origins: [...current, value] });
    setBusy(false);
    if (next) setOriginDraft('');
  };

  const removeOrigin = async (target: string) => {
    setBusy(true);
    await update({
      allowed_origins: (config?.allowed_origins ?? []).filter((item) => item !== target),
    });
    setBusy(false);
  };

  if (loading && !config) {
    return <div className='text-13px text-t-tertiary'>…</div>;
  }

  const enabled = !!config?.enabled;
  const origins = config?.allowed_origins ?? [];

  return (
    <div className='flex flex-col gap-14px'>
      {/* 开关 */}
      <div className='flex items-center justify-between'>
        <div>
          <div className='text-13px font-500'>
            {t('customerService.widget.enable', { defaultValue: '启用网页挂件' })}
          </div>
          <div className='mt-2px text-12px text-t-tertiary'>
            {t('customerService.widget.enableHint', {
              defaultValue: '开启后，官网访客无需登录即可与这位客服对话',
            })}
          </div>
        </div>
        <Switch checked={enabled} loading={busy} onChange={(checked) => void toggle(checked)} />
      </div>

      {enabled && config?.widget_key && (
        <>
          {/* 站点标识 */}
          <div>
            <div className='mb-4px text-12px text-t-tertiary'>
              {t('customerService.widget.siteKey', { defaultValue: '站点标识' })}
            </div>
            <Space>
              <Input readOnly value={config.widget_key} style={{ width: 260 }} />
              <Button
                size='small'
                onClick={() =>
                  void copy(
                    config.widget_key ?? '',
                    t('customerService.widget.keyCopied', { defaultValue: '站点标识已复制' })
                  )
                }
              >
                <span className='inline-flex items-center gap-4px'>
                  <Copy theme='outline' size='13' fill='currentColor' className='block' />
                  {t('customerService.widget.copy', { defaultValue: '复制' })}
                </span>
              </Button>
              <Popconfirm
                title={t('customerService.widget.rotateConfirmTitle', {
                  defaultValue: '重新生成站点标识？',
                })}
                content={t('customerService.widget.rotateConfirmContent', {
                  defaultValue: '旧标识会立即失效，已嵌入官网的旧代码将无法访问，需要同步替换。',
                })}
                onOk={() => void rotateKey()}
              >
                <Button size='small' status='warning' loading={busy}>
                  <span className='inline-flex items-center gap-4px'>
                    <Refresh theme='outline' size='13' fill='currentColor' className='block' />
                    {t('customerService.widget.rotate', { defaultValue: '重新生成' })}
                  </span>
                </Button>
              </Popconfirm>
            </Space>
          </div>

          {/* 嵌入代码 */}
          <div>
            <div className='mb-4px text-12px text-t-tertiary'>
              {t('customerService.widget.embedCode', { defaultValue: '嵌入代码（粘贴到官网 </body> 前）' })}
            </div>
            <div className='mb-8px'>
              <Input
                value={host}
                onChange={setHost}
                style={{ width: 260 }}
                placeholder={DEFAULT_WIDGET_HOST}
              />
            </div>
            <div className='rounded-6px bg-bg-secondary p-10px'>
              <code className='block break-all text-12px'>{embedCode}</code>
            </div>
            <Button
              size='small'
              type='primary'
              className='mt-8px'
              onClick={() =>
                void copy(
                  embedCode,
                  t('customerService.widget.codeCopied', { defaultValue: '嵌入代码已复制' })
                )
              }
            >
              <span className='inline-flex items-center gap-4px'>
                <Link theme='outline' size='13' fill='currentColor' className='block' />
                {t('customerService.widget.copyCode', { defaultValue: '复制嵌入代码' })}
              </span>
            </Button>
          </div>

          {/* 来源白名单 */}
          <div>
            <div className='mb-4px text-12px text-t-tertiary'>
              {t('customerService.widget.origins', { defaultValue: '允许接入的网站（留空表示不限制）' })}
            </div>
            <Space wrap>
              {origins.map((origin) => (
                <Tag key={origin} closable onClose={() => void removeOrigin(origin)}>
                  {origin}
                </Tag>
              ))}
            </Space>
            <Space className='mt-8px'>
              <Input
                value={originDraft}
                onChange={setOriginDraft}
                style={{ width: 260 }}
                placeholder='https://example.com'
                onPressEnter={() => void addOrigin()}
              />
              <Button size='small' disabled={!originDraft.trim()} onClick={() => void addOrigin()}>
                {t('customerService.widget.addOrigin', { defaultValue: '添加' })}
              </Button>
            </Space>
          </div>
        </>
      )}
    </div>
  );
};

export default CsWidgetSection;
