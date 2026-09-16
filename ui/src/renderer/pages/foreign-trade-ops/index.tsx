/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import DocToolkit from './DocToolkit';
import OrderLedger from './OrderLedger';

type WorkspaceTab = 'docs' | 'ledger';

/**
 * TradeFollowUpPage — B2B外贸跟单工作台。
 *
 * AI出海智能体分组下的第三个作业面，与前两个「工作台」形态不同：
 * 「外贸运营/业务工作台」是专家名册 + 内嵌对话（用人），本页是**干活**——
 * 上半部分是单证生产，下半部分是订单跟单。
 *
 * 两块能力互为闭环：
 *   - 单证工具箱：19 种外贸单证生成器，全部随包内置（`ui/public/trade-docs/`），
 *     离线可用、数据只落本机 localStorage；
 *   - 跟单台账：登记在跟订单的阶段 / 交期 / 单据齐套情况，缺哪张单可以直接
 *     一键跳到对应生成器，生成完回来打勾。
 *
 * 硬约束：本页不发起任何 AI 会话，也不跳转会话页——它是纯作业台。
 */
const TradeFollowUpPage: React.FC = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<WorkspaceTab>('docs');
  /** 台账点「去生成」时带到工具箱的目标单证文件。 */
  const [requestedDoc, setRequestedDoc] = useState<string | null>(null);

  const handleGenerateDoc = useCallback((file: string) => {
    setRequestedDoc(file);
    setTab('docs');
  }, []);

  const handleRequestedConsumed = useCallback(() => setRequestedDoc(null), []);

  const tabs: Array<{ id: WorkspaceTab; label: string }> = [
    { id: 'docs', label: t('common.tradeFollowUp.tabDocs') },
    { id: 'ledger', label: t('common.tradeFollowUp.tabLedger') },
  ];

  return (
    <div className='w-full box-border px-12px md:px-24px py-20px'>
      <div className='mx-auto w-full md:max-w-1600px h-[calc(100vh-120px)] min-h-560px flex flex-col'>
        {/* 页头：标题 + 说明 + pill 型 Tab（与侧栏其它入口同一视觉语言） */}
        <div className='shrink-0 mb-12px flex items-start justify-between gap-16px flex-wrap'>
          <div className='min-w-0'>
            <h1 className='m-0 text-17px font-600 leading-24px text-t-primary'>
              {t('common.tradeFollowUp.title')}
            </h1>
            <p className='m-0 mt-4px text-12px leading-18px text-t-tertiary'>
              {t('common.tradeFollowUp.subtitle')}
            </p>
          </div>
          <div className='shrink-0 inline-flex items-center gap-4px p-3px rd-999px border border-[var(--color-border-2)] bg-[var(--color-bg-2)]'>
            {tabs.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={classNames(
                  'h-28px px-14px rd-999px text-13px font-[500] border-0 cursor-pointer transition-colors',
                  tab === item.id
                    ? 'bg-primary-6 text-white'
                    : 'bg-transparent text-t-secondary hover:bg-fill-2'
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* 作业区 */}
        <div className='flex-1 min-h-0 flex flex-col border border-[var(--color-border-2)] rd-12px overflow-hidden bg-[var(--color-bg-1)]'>
          {tab === 'docs' ? (
            <DocToolkit requestedFile={requestedDoc} onRequestedFileConsumed={handleRequestedConsumed} />
          ) : (
            <OrderLedger onGenerateDoc={handleGenerateDoc} />
          )}
        </div>
      </div>
    </div>
  );
};

export default TradeFollowUpPage;
