/**
 * PluginSettingsPanel — installed-plugins list plus the ClawHub plugin market.
 * Market "Add" only prepares a DRAFT GeekClaw conversation (`send: false`); the
 * install command is never executed without the user reviewing and sending it.
 */
import { ipcBridge } from '@/common';
import type { IExtensionInfo, ISkillMarketItem } from '@/common/adapter/ipcBridge';
import type { PresetTag } from '@/common/types/agent/presetTypes';
import { resolveLocaleKey } from '@/common/utils';
import { Tag } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MarketSettingsPanel from '@/renderer/pages/settings/MarketSettingsPanel';
import {
  buildSkillMarketConversationName,
  buildSkillMarketInstallPrompt,
  PLUGIN_MARKET_SOURCES,
} from '@/renderer/pages/settings/skill/skillMarket';
import { useGeekClawQuickStart } from '@/renderer/hooks/agent/useGeekClawQuickStart';
import SkillMarketCard from '@/renderer/pages/settings/skill/SkillMarketCard';

type PluginSettingsPanelProps = {
  section?: 'installed' | 'market' | 'both';
};

const PluginSettingsPanel: React.FC<PluginSettingsPanelProps> = ({ section = 'both' }) => {
  const { t, i18n } = useTranslation();
  const localeKey = resolveLocaleKey(i18n.language);
  const { start } = useGeekClawQuickStart();
  const [extensions, setExtensions] = useState<IExtensionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const showInstalled = section !== 'market';
  const showMarket = section !== 'installed';

  useEffect(() => {
    if (!showInstalled) {
      setLoading(false);
      return;
    }

    void ipcBridge.extensions.getLoadedExtensions
      .invoke()
      .then(setExtensions)
      .catch((error) => {
        console.error('Failed to load installed plugins:', error);
        setExtensions([]);
      })
      .finally(() => setLoading(false));
  }, [showInstalled]);

  const handleAdd = useCallback(
    async (item: ISkillMarketItem) => {
      await start({
        name: buildSkillMarketConversationName(item, localeKey),
        prompt: buildSkillMarketInstallPrompt(item, localeKey),
        send: false,
      });
    },
    [localeKey, start]
  );

  /** 精选插件：源自跨境外贸插件市场，已去 Accio 化 */
  const featuredPlugins: ISkillMarketItem[] = [
    {
      id: 'geekclaw-procurement-toolkit',
      source: 'geekclaw_featured',
      rank: 1,
      name: '采购工具箱',
      description: 'AI 采购团队：寻源、谈判、订单跟踪与供应商管理一站式能力。',
      url: 'https://geekclaw.ai/plugins/procurement-toolkit',
      install_command: 'openclaw plugins install geekclaw:procurement-toolkit',
      tags: ['procurement', 'supply-chain'],
    },
    {
      id: 'geekclaw-intl-station',
      source: 'geekclaw_featured',
      rank: 2,
      name: '国际站生意助手',
      description: '为 B2B 国际站提供选品、发品、素材生成到店铺经营分析的全链路方案。',
      url: 'https://geekclaw.ai/plugins/intl-station',
      install_command: 'openclaw plugins install geekclaw:intl-station',
      tags: ['b2b', 'operations'],
    },
    {
      id: 'geekclaw-okki-crm',
      source: 'geekclaw_featured',
      rank: 3,
      name: 'OKKI CRM',
      description: '外贸客户全生命周期管理、商机跟进与订单协同。',
      url: 'https://geekclaw.ai/plugins/okki-crm',
      install_command: 'openclaw plugins install geekclaw:okki-crm',
      tags: ['crm', 'sales'],
    },
    {
      id: 'geekclaw-1688-procurement',
      source: 'geekclaw_featured',
      rank: 4,
      name: '1688 采购工具集',
      description: '为 1688 买家提供选品找货、询盘比价、分销铺货与订单管理。',
      url: 'https://geekclaw.ai/plugins/1688-procurement',
      install_command: 'openclaw plugins install geekclaw:1688-procurement',
      tags: ['procurement', '1688'],
    },
    {
      id: 'geekclaw-shopify',
      source: 'geekclaw_featured',
      rank: 5,
      name: 'Shopify',
      description: 'Shopify 建站与运营插件：接入店铺、上架商品、管理订单与数据分析。',
      url: 'https://geekclaw.ai/plugins/shopify',
      install_command: 'openclaw plugins install geekclaw:shopify',
      tags: ['shopify', 'ecommerce'],
    },
    {
      id: 'geekclaw-shopline',
      source: 'geekclaw_featured',
      rank: 6,
      name: 'SHOPLINE',
      description: '开口即可运营 SHOPLINE 店铺：商品上架、库存、订单与客户查询。',
      url: 'https://geekclaw.ai/plugins/shopline',
      install_command: 'openclaw plugins install geekclaw:shopline',
      tags: ['shopline', 'ecommerce'],
    },
    {
      id: 'geekclaw-ec-design',
      source: 'geekclaw_featured',
      rank: 7,
      name: '跨境电商设计',
      description: '覆盖素材分析、商品图片生成、品牌策划与营销投放四大设计模块。',
      url: 'https://geekclaw.ai/plugins/ec-design',
      install_command: 'openclaw plugins install geekclaw:ec-design',
      tags: ['design', 'creative'],
    },
    {
      id: 'geekclaw-ai-site-builder',
      source: 'geekclaw_featured',
      rank: 8,
      name: 'AI 建站',
      description: '从对话到可上线网站：智能生成页面、内容与素材。',
      url: 'https://geekclaw.ai/plugins/ai-site-builder',
      install_command: 'openclaw plugins install geekclaw:ai-site-builder',
      tags: ['website', 'ai'],
    },
    {
      id: 'geekclaw-dingtalk',
      source: 'geekclaw_featured',
      rank: 9,
      name: '钉钉',
      description: '钉钉官方办公能力集成：消息、日程、审批与待办。',
      url: 'https://geekclaw.ai/plugins/dingtalk',
      install_command: 'openclaw plugins install geekclaw:dingtalk',
      tags: ['office', 'im'],
    },
    {
      id: 'geekclaw-yuque',
      source: 'geekclaw_featured',
      rank: 10,
      name: '语雀',
      description: '知识管理与文档协作：检索、读写与结构化沉淀。',
      url: 'https://geekclaw.ai/plugins/yuque',
      install_command: 'openclaw plugins install geekclaw:yuque',
      tags: ['knowledge', 'document'],
    },
    {
      id: 'geekclaw-feishu',
      source: 'geekclaw_featured',
      rank: 11,
      name: '飞书',
      description: '飞书官方办公能力集成：文档、表格、日历与消息协同。',
      url: 'https://geekclaw.ai/plugins/feishu',
      install_command: 'openclaw plugins install geekclaw:feishu',
      tags: ['office', 'im'],
    },
    {
      id: 'geekclaw-mydepot',
      source: 'geekclaw_featured',
      rank: 12,
      name: 'MyDepot 货盘',
      description: '跨境货盘资源整合：选品、供应链对接与一键代发。',
      url: 'https://geekclaw.ai/plugins/mydepot',
      install_command: 'openclaw plugins install geekclaw:mydepot',
      tags: ['dropshipping', 'supply-chain'],
    },
    {
      id: 'geekclaw-dianxiaobao',
      source: 'geekclaw_featured',
      rank: 13,
      name: '店小宝',
      description: '多平台店铺运营助手：铺货、刊登、订单与数据看板。',
      url: 'https://geekclaw.ai/plugins/dianxiaobao',
      install_command: 'openclaw plugins install geekclaw:dianxiaobao',
      tags: ['operations', 'multichannel'],
    },
    {
      id: 'geekclaw-visable',
      source: 'geekclaw_featured',
      rank: 14,
      name: 'Visable',
      description: '欧洲 B2B 平台曝光与欧洲买家开发。',
      url: 'https://geekclaw.ai/plugins/visable',
      install_command: 'openclaw plugins install geekclaw:visable',
      tags: ['b2b', 'europe'],
    },
    {
      id: 'geekclaw-apollo',
      source: 'geekclaw_featured',
      rank: 15,
      name: 'Apollo.io',
      description: 'B2B 公司调研与 CRM 工具：按域名富化公司、查看在招岗位作为销售信号、搜索/保存 CRM 联系人和公司、列出邮件序列。',
      url: 'https://geekclaw.ai/plugins/apollo',
      install_command: 'openclaw plugins install geekclaw:apollo',
      tags: ['apollo', 'sales', 'b2b', 'crm', 'company-enrichment', 'job-postings', 'research'],
    },
  ];
  const emptyTagMap = new Map<string, PresetTag>();

  return (
    <div className='space-y-16px pb-24px'>
      {showInstalled && (
        <div className='bg-fill-2 rounded-24px p-20px'>
          <div className='flex items-start justify-between gap-12px mb-14px'>
            <div>
              <h2 className='m-0 text-22px font-600 text-t-primary'>
                {t('settings.plugins.installedTitle', { defaultValue: 'Installed Plugins' })}
              </h2>
              <p className='mt-6px mb-0 text-13px text-t-secondary'>
                {t('settings.plugins.installedDescription', {
                  defaultValue: 'Loaded GeekClaw extensions and plugin packages currently available to the app.',
                })}
              </p>
            </div>
          </div>

          {loading ? (
            <div className='py-24px text-center text-t-secondary text-14px'>
              {t('common.loading', { defaultValue: 'Loading...' })}
            </div>
          ) : extensions.length === 0 ? (
            <div className='py-24px text-center text-t-secondary text-14px border border-dashed border-arco-2 rd-12px'>
              {t('settings.plugins.emptyInstalled', { defaultValue: 'No installed plugins found.' })}
            </div>
          ) : (
            <div
              className='grid gap-12px'
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))' }}
            >
              {extensions.map((extension) => (
                <div
                  key={extension.name}
                  className='rounded-16px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-14px'
                >
                  <div className='flex items-start justify-between gap-10px'>
                    <div className='min-w-0'>
                      <div className='truncate text-14px font-medium text-t-primary'>
                        {extension.display_name || extension.name}
                      </div>
                      <div className='mt-3px text-11px text-t-tertiary font-mono truncate'>{extension.name}</div>
                    </div>
                    <Tag
                      size='small'
                      bordered={false}
                      className={
                        extension.enabled
                          ? '!bg-[rgba(var(--success-6),0.1)] !text-success-6'
                          : '!bg-[var(--color-fill-2)] !text-t-tertiary'
                      }
                    >
                      {extension.enabled
                        ? t('settings.plugins.stateEnabled', { defaultValue: 'Enabled' })
                        : t('settings.plugins.stateDisabled', { defaultValue: 'Disabled' })}
                    </Tag>
                  </div>
                  {extension.description && (
                    <div className='mt-10px text-12px leading-18px text-t-secondary line-clamp-2'>
                      {extension.description}
                    </div>
                  )}
                  <div className='mt-12px text-11px text-t-tertiary'>v{extension.version}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showMarket && (
        <div className='bg-fill-2 rounded-24px p-20px'>
          <div className='mb-14px'>
            <h2 className='m-0 text-22px font-600 text-t-primary'>
              {t('settings.plugins.featuredTitle', { defaultValue: 'Featured Plugins' })}
            </h2>
            <p className='mt-6px mb-0 text-13px text-t-secondary'>
              {t('settings.plugins.featuredDescription', {
                defaultValue: 'Curated cross-border plugins ready to extend your GeekClaw workspace.',
              })}
            </p>
          </div>
          <div
            className='grid gap-12px'
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(232px, 100%), 1fr))' }}
          >
            {featuredPlugins.map((item) => (
              <SkillMarketCard
                key={item.id}
                item={item}
                tagByKey={emptyTagMap}
                localeKey={localeKey}
                onAdd={handleAdd}
              />
            ))}
          </div>
        </div>
      )}

      {showMarket && (
        <MarketSettingsPanel
          title={t('settings.plugins.marketTitle', { defaultValue: 'Plugin Market' })}
          description={t('settings.plugins.marketDescription', {
            defaultValue: 'Browse ClawHub plugins and prepare an installation draft for review.',
          })}
          sources={PLUGIN_MARKET_SOURCES}
          cacheKey='geekclaw.pluginMarket.rankings.v1'
          autoSyncKey='geekclaw.pluginMarket.autoSynced.v1'
          defaultSource='clawhub_plugins'
          searchPlaceholder={t('settings.plugins.searchPlaceholder', { defaultValue: 'Search plugins...' })}
          emptyText={t('settings.plugins.emptyMarket', { defaultValue: 'Refresh to load plugin market entries.' })}
          onAdd={handleAdd}
          testIdPrefix='plugin-market'
        />
      )}
    </div>
  );
};

export default PluginSettingsPanel;
