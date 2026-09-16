/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@arco-design/web-react';
import { Refresh, Search } from '@icon-park/react';
import classNames from 'classnames';
import { TRADE_DOCS, TRADE_DOC_GROUPS, tradeDocUrl } from './catalog';
import type { TradeDocItem } from './catalog';

/** 按当前界面语言取单证名 / 说明。 */
function useDocText() {
  const { i18n } = useTranslation();
  const isZh = (i18n.language || '').toLowerCase().startsWith('zh');
  return useCallback(
    (item: TradeDocItem) => ({
      name: isZh ? item.zh : item.en,
      desc: isZh ? item.zhDesc : item.enDesc,
    }),
    [isZh]
  );
}

interface DocToolkitProps {
  /** 点「去生成」时由台账传入的目标单证（用后即清空）。 */
  requestedFile?: string | null;
  onRequestedFileConsumed?: () => void;
}

/**
 * DocToolkit — 单证工具箱。
 *
 * 左侧是按跟单作业顺序分组的单证目录，右侧用 iframe 加载随包内置的单证生成器页面。
 * 生成器本身是纯静态页面（数据只写浏览器 localStorage），因此完全离线可用，
 * 不需要任何外部站点或后端服务。
 */
const DocToolkit: React.FC<DocToolkitProps> = ({ requestedFile, onRequestedFileConsumed }) => {
  const { t } = useTranslation();
  const docText = useDocText();

  const [selected, setSelected] = useState<string>(TRADE_DOCS[0].file);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // 台账里点「去生成」→ 切到对应单证。
  useEffect(() => {
    if (!requestedFile) return;
    if (TRADE_DOCS.some((item) => item.file === requestedFile)) {
      setSelected(requestedFile);
      setLoading(true);
    }
    onRequestedFileConsumed?.();
  }, [requestedFile, onRequestedFileConsumed]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return TRADE_DOCS;
    return TRADE_DOCS.filter((item) => {
      const { name, desc } = docText(item);
      return (
        name.toLowerCase().includes(kw) ||
        desc.toLowerCase().includes(kw) ||
        item.en.toLowerCase().includes(kw) ||
        item.zh.includes(keyword.trim())
      );
    });
  }, [keyword, docText]);

  const grouped = useMemo(() => {
    return TRADE_DOC_GROUPS.map((group) => ({
      id: group,
      items: filtered.filter((item) => item.group === group),
    })).filter((entry) => entry.items.length > 0);
  }, [filtered]);

  const active = TRADE_DOCS.find((item) => item.file === selected) ?? TRADE_DOCS[0];
  const activeText = docText(active);

  const handleReload = useCallback(() => {
    setLoading(true);
    setReloadKey((value) => value + 1);
  }, []);

  return (
    <div className='flex-1 min-h-0 flex'>
      {/* 左：单证目录 */}
      <aside className='shrink-0 w-232px min-h-0 flex flex-col border-r border-[var(--color-border-2)] bg-[var(--color-bg-2)]'>
        <div className='shrink-0 p-10px border-b border-[var(--color-border-2)]'>
          <Input
            size='small'
            allowClear
            value={keyword}
            onChange={setKeyword}
            prefix={<Search theme='outline' size={13} />}
            placeholder={t('common.tradeFollowUp.searchDoc', { defaultValue: '搜索单证…' })}
          />
        </div>
        <div className='flex-1 min-h-0 overflow-y-auto p-8px'>
          {grouped.length === 0 ? (
            <div className='py-32px text-center text-12px text-t-tertiary'>
              {t('common.tradeFollowUp.noDoc', { defaultValue: '没有匹配的单证' })}
            </div>
          ) : (
            grouped.map((group) => (
              <section key={group.id} className='mb-6px'>
                <h4 className='px-8px mt-10px mb-6px text-12px font-[500] text-t-tertiary select-none'>
                  {t(`common.tradeFollowUp.group.${group.id}`)}
                </h4>
                <div className='flex flex-col gap-2px'>
                  {group.items.map((item) => {
                    const { name } = docText(item);
                    const isActive = item.file === selected;
                    return (
                      <div
                        key={item.file}
                        onClick={() => {
                          setSelected(item.file);
                          setLoading(true);
                        }}
                        className={classNames(
                          'group h-30px px-8px rd-6px flex items-center justify-between gap-6px cursor-pointer transition-colors',
                          isActive ? '!bg-primary-1 !text-primary-6' : 'hover:bg-fill-2 active:bg-fill-3'
                        )}
                      >
                        <span className='min-w-0 truncate text-13px text-t-primary'>{name}</span>
                        {item.hot && (
                          <span className='shrink-0 px-4px rd-4px text-10px leading-15px bg-[var(--color-fill-2)] text-t-tertiary'>
                            {t('common.tradeFollowUp.hot', { defaultValue: '常用' })}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </aside>

      {/* 右：单证生成器 */}
      <div className='flex-1 min-w-0 min-h-0 flex flex-col'>
        <div className='shrink-0 h-42px px-14px flex items-center gap-10px border-b border-[var(--color-border-2)] bg-[var(--color-bg-2)]'>
          <span className='shrink-0 text-13px font-600 text-t-primary'>{activeText.name}</span>
          <span className='min-w-0 flex-1 truncate text-12px text-t-tertiary'>{activeText.desc}</span>
          <button
            onClick={handleReload}
            title={t('common.tradeFollowUp.reload', { defaultValue: '重新加载' })}
            className='shrink-0 inline-flex items-center gap-4px h-26px px-8px text-12px text-t-secondary border border-[var(--color-border-2)] rd-6px bg-transparent hover:bg-fill-2 cursor-pointer transition-colors'
          >
            <Refresh theme='outline' size={12} />
            {t('common.tradeFollowUp.reload', { defaultValue: '重新加载' })}
          </button>
        </div>
        <div className='flex-1 min-h-0 relative bg-white'>
          {loading && (
            <div className='absolute inset-0 z-10 flex items-center justify-center bg-white text-13px text-t-tertiary'>
              {t('common.tradeFollowUp.loading')}
            </div>
          )}
          <iframe
            key={`${selected}-${reloadKey}`}
            src={tradeDocUrl(selected)}
            title={activeText.name}
            onLoad={() => setLoading(false)}
            // 内置静态页面，脚本与 localStorage 均为自身所需；allow-downloads 供导出 PDF 使用。
            sandbox='allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads'
            className='w-full h-full border-0 bg-white'
          />
        </div>
      </div>
    </div>
  );
};

export default DocToolkit;
