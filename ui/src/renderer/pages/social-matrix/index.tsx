/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Message, Spin, Tabs, Tag, Tooltip } from '@arco-design/web-react';
import { Broadcast, ChartHistogram, Export, FileEditingOne, Link, ListView } from '@icon-park/react';
import classNames from 'classnames';
import { isDemoMode, setDemoMode } from './cloudApi';
import { useSocialMatrix } from './useSocialMatrix';
import AccountsPanel from './AccountsPanel';
import ComposePanel from './ComposePanel';
import SchedulePanel from './SchedulePanel';
import DeliveryPanel from './DeliveryPanel';
import AnalyticsPanel from './AnalyticsPanel';

type TabKey = 'accounts' | 'compose' | 'schedule' | 'delivery' | 'analytics';

/**
 * SocialMatrixPage — 海外社媒矩阵工作台。
 *
 * 定位：把一份出海内容**一次创作、按平台差异化改写、投放到多个社媒账号**，
 * 并按队列与日历排期自动发布、回收互动指标。
 *
 * 架构要点（决定了这一页为什么长这样）：
 *   - **社交引擎常驻云端**：OAuth 授权、排期、发布、指标回收都在服务端完成。
 *     排期帖必须由服务端发出——用户关掉电脑也要按时投递；OAuth 回调也必须是
 *     公网可达的固定地址。因此桌面端不持有任何平台密钥，也不参与发布；
 *   - **桌面端只做两件事**：把内容编排好、把结果展示清楚；
 *   - **平台密钥缺失是一等状态**：某平台开发者应用还没配置时，界面如实显示
 *     「待接入」并说明原因，不报错、不假装可用。
 *
 * 数据模型取自成熟社媒产品（Mixpost）的域模型：一条内容对多账号，逐平台独立
 * 记录投递结果与失败原因；平台能力约束（是否必须带媒体、字数上限）集中在
 * `platforms.ts`，提交前统一把关。
 */
const SocialMatrixPage: React.FC = () => {
  const { t } = useTranslation();
  const matrix = useSocialMatrix();
  const [tab, setTab] = useState<TabKey>('accounts');
  const [demo, setDemo] = useState(isDemoMode());

  const toggleDemo = () => {
    const next = !demo;
    setDemoMode(next);
    setDemo(next);
    Message.info(next ? '已开启演示模式' : '已关闭演示模式');
    void matrix.reload();
  };

  const accountCount = matrix.snapshot.accounts.length;

  const tabItems = useMemo(
    () => [
      {
        key: 'accounts',
        title: (
          <span className='flex items-center gap-6px'>
            <Link theme='outline' size={14} />
            账号矩阵
            {accountCount > 0 && <Tag size='small'>{accountCount}</Tag>}
          </span>
        ),
      },
      {
        key: 'compose',
        title: (
          <span className='flex items-center gap-6px'>
            <FileEditingOne theme='outline' size={14} />
            内容创作
          </span>
        ),
      },
      {
        key: 'schedule',
        title: (
          <span className='flex items-center gap-6px'>
            <Export theme='outline' size={14} />
            排期队列
            {matrix.scheduledPosts.length > 0 && (
              <Tag size='small'>{matrix.scheduledPosts.length}</Tag>
            )}
          </span>
        ),
      },
      {
        key: 'delivery',
        title: (
          <span className='flex items-center gap-6px'>
            <ListView theme='outline' size={14} />
            发布记录
          </span>
        ),
      },
      {
        key: 'analytics',
        title: (
          <span className='flex items-center gap-6px'>
            <ChartHistogram theme='outline' size={14} />
            数据看板
          </span>
        ),
      },
    ],
    [accountCount, matrix.scheduledPosts.length]
  );

  const renderBody = () => {
    if (matrix.status === 'loading') {
      return (
        <div className='flex items-center justify-center py-80px'>
          <Spin dot />
        </div>
      );
    }

    if (matrix.status === 'not-signed-in') {
      return (
        <div className='box-border rounded-8px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] px-20px py-24px text-13px leading-22px text-t-secondary'>
          <div className='mb-8px text-14px font-[600] text-t-primary'>需要先登录云端账号</div>
          社媒矩阵的账号授权、排期与发布都在云端完成，因此需要先用 GeekClaw 账号登录。
          <div className='mt-12px'>登录后回到本页即可看到你的矩阵。</div>
        </div>
      );
    }

    if (matrix.status === 'cloud-unavailable') {
      return (
        <div className='box-border rounded-8px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] px-20px py-24px text-13px leading-22px text-t-secondary'>
          <div className='mb-8px text-14px font-[600] text-t-primary'>云端社媒服务暂不可用</div>
          云端还没有部署社媒引擎，或当前网络无法连通。可以先用演示模式查看这个工作台的完整形态。
          <div className='mt-12px'>
            <Button size='small' onClick={toggleDemo}>
              {demo ? '关闭演示模式' : '开启演示模式'}
            </Button>
          </div>
        </div>
      );
    }

    switch (tab) {
      case 'accounts':
        return (
          <AccountsPanel
            accountsByPlatform={matrix.accountsByPlatform}
            platformState={matrix.platformState}
            demo={demo}
            reload={matrix.reload}
          />
        );
      case 'compose':
        return (
          <ComposePanel
            accountsByPlatform={matrix.accountsByPlatform}
            platformState={matrix.platformState}
            demo={demo}
            onCreated={async () => {
              await matrix.reload();
              setTab('schedule');
            }}
          />
        );
      case 'schedule':
        return (
          <SchedulePanel
            scheduledPosts={matrix.scheduledPosts}
            drafts={matrix.drafts}
            demo={demo}
            reload={matrix.reload}
          />
        );
      case 'delivery':
        return <DeliveryPanel deliveredPosts={matrix.deliveredPosts} />;
      case 'analytics':
        return (
          <AnalyticsPanel
            metricsByPlatform={matrix.metricsByPlatform}
            hasAccounts={accountCount > 0}
          />
        );
      default:
        return null;
    }
  };

  const configuredCount = matrix.platformState.filter((p) => p.configured).length;

  return (
    <div className='w-full box-border px-12px md:px-24px py-20px'>
      <div className='mx-auto w-full md:max-w-1600px flex flex-col'>
        {/* 页头 */}
        <div className='mb-16px flex items-start gap-12px'>
          <div className='flex items-center justify-center rounded-10px bg-[var(--color-primary-1)] shrink-0 size-38px'>
            <Broadcast theme='outline' size={20} fill='var(--color-primary-6)' />
          </div>
          <div className='flex flex-col gap-3px min-w-0'>
            <div className='flex items-center gap-8px'>
              <span className='text-17px font-[600] leading-24px text-t-primary'>
                {t('common.siderRail.socialMatrix', { defaultValue: '海外社媒矩阵工作台' })}
              </span>
              {matrix.status === 'ready' && matrix.source === 'demo' && (
                <Tag size='small' color='orange'>
                  演示数据
                </Tag>
              )}
            </div>
            <span className='text-12px leading-18px text-t-tertiary'>
              一次创作，按平台差异化改写，投放 LinkedIn / Facebook / Instagram / YouTube / X /
              TikTok 账号矩阵；服务端按队列与日历自动发布，并回收互动指标。
            </span>
          </div>

          <div className='flex-1' />

          <div className='flex items-center gap-8px shrink-0'>
            <Tooltip
              position='bottom'
              content={`已连接 ${accountCount} 个账号 · 服务端已配置 ${configuredCount}/6 个平台`}
            >
              <span
                className={classNames(
                  'text-11px px-8px py-3px rounded-4px cursor-default',
                  configuredCount > 0
                    ? 'bg-[var(--color-fill-1)] text-t-tertiary'
                    : 'bg-[#fff7e8] text-[#ff7d00]'
                )}
              >
                {configuredCount}/6 平台已接入
              </span>
            </Tooltip>
            <Button size='small' onClick={toggleDemo}>
              {demo ? '退出演示' : '演示模式'}
            </Button>
          </div>
        </div>

        {/* 主体 */}
        <div className='box-border rounded-10px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)]'>
          {matrix.status === 'ready' ? (
            <Tabs
              activeTab={tab}
              onChange={(key) => setTab(key as TabKey)}
              type='line'
              className='px-12px'
            >
              {tabItems.map((item) => (
                <Tabs.TabPane key={item.key} title={item.title}>
                  <div className='pb-16px'>{renderBody()}</div>
                </Tabs.TabPane>
              ))}
            </Tabs>
          ) : (
            <div className='p-16px'>{renderBody()}</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SocialMatrixPage;
