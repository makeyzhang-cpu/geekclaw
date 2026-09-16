/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Message, Modal, Spin, Tooltip } from '@arco-design/web-react';
import { Download, FileExcel, FilePpt, FileText, FileWord, PreviewOpen, Search } from '@icon-park/react';
import classNames from 'classnames';
import { TRADE_KB_BASE, downloadTradeKbFile, useTradeKbManifest } from './useTradeKb';
import type { TradeKbFile, TradeKbKind } from './useTradeKb';

const KIND_ICON: Record<TradeKbKind, React.ReactNode> = {
  excel: <FileExcel theme='outline' size={18} />,
  word: <FileWord theme='outline' size={18} />,
  ppt: <FilePpt theme='outline' size={18} />,
  other: <FileText theme='outline' size={18} />,
};

const KIND_COLOR: Record<TradeKbKind, string> = {
  excel: '#00b42a',
  word: '#165dff',
  ppt: '#f77234',
  other: '#86909c',
};

/**
 * TradeKnowledgePage — 外贸人知识库。
 *
 * 随安装包内置的一整套外贸业务表格与文档模板（客户管理 / 跟进体系 / 话术 /
 * 市场调研 / 展会拜访 / 营销推广 / 团队绩效 / 单证模板 / 使用说明）。
 *
 * 资源与预览页都在构建期生成、随前端打包，所以：
 *   - 「在线查阅」打开的是构建期转好的静态预览页（表格 → 网页表格、文档 → 网页正文），
 *     不依赖 officecli、Office 或任何后端服务，断网也能用；
 *   - 「下载」拿到的是原始文件（.xls/.xlsx/.doc/.docx/.ppt/.pptx 原格式），可直接编辑使用。
 */
const TradeKnowledgePage: React.FC = () => {
  const { t } = useTranslation();
  const { status, manifest, reload } = useTradeKbManifest();

  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [previewFile, setPreviewFile] = useState<TradeKbFile | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const file of manifest?.files ?? []) {
      map.set(file.category, (map.get(file.category) ?? 0) + 1);
    }
    return map;
  }, [manifest]);

  const visible = useMemo(() => {
    const files = manifest?.files ?? [];
    const kw = keyword.trim().toLowerCase();
    return files.filter((file) => {
      if (category !== 'all' && file.category !== category) return false;
      if (!kw) return true;
      return `${file.name} ${file.summary} ${file.ext}`.toLowerCase().includes(kw);
    });
  }, [manifest, keyword, category]);

  const handleDownload = useCallback(
    async (file: TradeKbFile) => {
      setDownloadingId(file.id);
      try {
        await downloadTradeKbFile(file);
        Message.success(t('common.tradeKnowledge.downloaded', { name: file.name }));
      } catch {
        Message.error(t('common.tradeKnowledge.downloadFailed'));
      } finally {
        setDownloadingId(null);
      }
    },
    [t]
  );

  const categoryName = useCallback(
    (id: string) => manifest?.categories.find((item) => item.id === id)?.name ?? id,
    [manifest]
  );

  return (
    <div className='w-full box-border px-12px md:px-24px py-20px'>
      <div className='mx-auto w-full md:max-w-1600px h-[calc(100vh-120px)] min-h-560px flex flex-col'>
        {/* 页头 */}
        <div className='shrink-0 mb-12px flex items-start justify-between gap-16px flex-wrap'>
          <div className='min-w-0'>
            <h1 className='m-0 text-17px font-600 leading-24px text-t-primary'>
              {t('common.tradeKnowledge.title')}
            </h1>
            <p className='m-0 mt-4px text-12px leading-18px text-t-tertiary'>
              {t('common.tradeKnowledge.subtitle')}
            </p>
          </div>
          {manifest && (
            <div className='shrink-0 flex items-center gap-8px flex-wrap'>
              <StatChip value={manifest.stats.files} label={t('common.tradeKnowledge.statFiles')} />
              <StatChip value={manifest.stats.categories} label={t('common.tradeKnowledge.statCategories')} />
              <StatChip value={manifest.stats.bytesText} label={t('common.tradeKnowledge.statSize')} />
            </div>
          )}
        </div>

        {status === 'loading' && (
          <div className='flex-1 min-h-0 flex flex-col items-center justify-center gap-10px'>
            <Spin size={28} />
            <span className='text-13px text-t-tertiary'>{t('common.tradeKnowledge.loading')}</span>
          </div>
        )}

        {status === 'error' && (
          <div className='flex-1 min-h-0 flex flex-col items-center justify-center gap-10px'>
            <span className='text-13px text-t-secondary'>{t('common.tradeKnowledge.loadFailed')}</span>
            <Button size='small' onClick={() => void reload()}>
              {t('common.tradeKnowledge.retry')}
            </Button>
          </div>
        )}

        {status === 'ready' && manifest && (
          <div className='flex-1 min-h-0 flex border border-[var(--color-border-2)] rd-12px overflow-hidden bg-[var(--color-bg-1)]'>
            {/* 左：分类目录 */}
            <aside className='shrink-0 w-200px min-h-0 flex flex-col border-r border-[var(--color-border-2)] bg-[var(--color-bg-2)]'>
              <div className='flex-1 min-h-0 overflow-y-auto p-8px'>
                <CategoryItem
                  label={t('common.tradeKnowledge.all')}
                  count={manifest.stats.files}
                  active={category === 'all'}
                  onClick={() => setCategory('all')}
                />
                {manifest.categories.map((item) => (
                  <CategoryItem
                    key={item.id}
                    label={item.name}
                    count={counts.get(item.id) ?? 0}
                    active={category === item.id}
                    onClick={() => setCategory(item.id)}
                  />
                ))}
              </div>
            </aside>

            {/* 右：文件列表 */}
            <div className='flex-1 min-w-0 min-h-0 flex flex-col'>
              <div className='shrink-0 p-12px border-b border-[var(--color-border-2)] bg-[var(--color-bg-2)]'>
                <Input
                  size='small'
                  allowClear
                  value={keyword}
                  onChange={setKeyword}
                  prefix={<Search theme='outline' size={13} />}
                  placeholder={t('common.tradeKnowledge.searchPlaceholder')}
                  className='max-w-360px'
                />
              </div>
              <div className='flex-1 min-h-0 overflow-y-auto p-12px'>
                {visible.length === 0 ? (
                  <div className='py-64px text-center text-13px text-t-tertiary'>
                    {t('common.tradeKnowledge.empty')}
                  </div>
                ) : (
                  <div className='grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-12px'>
                    {visible.map((file) => (
                      <FileCard
                        key={file.id}
                        file={file}
                        categoryName={categoryName(file.category)}
                        busy={downloadingId === file.id}
                        onPreview={() => setPreviewFile(file)}
                        onDownload={() => void handleDownload(file)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 在线查阅 */}
      <Modal
        visible={!!previewFile}
        title={previewFile?.name}
        footer={null}
        style={{ width: 'min(1180px, 92vw)' }}
        onCancel={() => setPreviewFile(null)}
        autoFocus={false}
      >
        {previewFile?.preview ? (
          <div className='flex flex-col gap-10px'>
            <div className='flex items-center justify-between gap-12px flex-wrap'>
              <span className='text-12px leading-18px text-t-tertiary'>{previewFile.summary}</span>
              <Button size='small' type='primary' icon={<Download size={13} />} onClick={() => void handleDownload(previewFile)}>
                {t('common.tradeKnowledge.download')}
              </Button>
            </div>
            <iframe
              key={previewFile.id}
              src={`${TRADE_KB_BASE}${previewFile.preview}`}
              title={previewFile.name}
              sandbox=''
              className='w-full h-[68vh] border border-[var(--color-border-2)] rd-8px bg-white'
            />
          </div>
        ) : (
          <div className='py-32px text-center text-13px text-t-secondary'>{previewFile?.previewNote}</div>
        )}
      </Modal>
    </div>
  );
};

const StatChip: React.FC<{ value: React.ReactNode; label: string }> = ({ value, label }) => (
  <span className='inline-flex items-baseline gap-4px h-28px px-12px rd-999px border border-[var(--color-border-2)] bg-[var(--color-bg-2)] text-12px text-t-tertiary'>
    <b className='text-13px font-600 text-t-primary'>{value}</b>
    {label}
  </span>
);

const CategoryItem: React.FC<{ label: string; count: number; active: boolean; onClick: () => void }> = ({
  label,
  count,
  active,
  onClick,
}) => (
  <div
    onClick={onClick}
    className={classNames(
      'h-32px px-10px rd-6px flex items-center justify-between gap-8px cursor-pointer transition-colors',
      active ? '!bg-primary-1 !text-primary-6' : 'hover:bg-fill-2 active:bg-fill-3'
    )}
  >
    <span className='min-w-0 truncate text-13px text-t-primary'>{label}</span>
    <span className='shrink-0 text-11px text-t-tertiary'>{count}</span>
  </div>
);

interface FileCardProps {
  file: TradeKbFile;
  categoryName: string;
  /** 该文件正在下载中。 */
  busy: boolean;
  onPreview: () => void;
  onDownload: () => void;
}

const FileCard: React.FC<FileCardProps> = ({ file, categoryName, busy, onPreview, onDownload }) => {
  const { t } = useTranslation();
  const previewable = !!file.preview;

  return (
    <div className='group flex flex-col gap-10px p-14px rd-12px border border-[var(--color-border-2)] bg-[var(--color-bg-2)] transition-colors hover:border-[var(--color-border-3)]'>
      <div className='flex items-start gap-10px'>
        <span
          className='shrink-0 size-32px rd-8px flex items-center justify-center bg-[var(--color-fill-2)]'
          style={{ color: KIND_COLOR[file.kind] }}
        >
          {KIND_ICON[file.kind]}
        </span>
        <div className='min-w-0 flex-1'>
          <div className='text-13px font-500 leading-18px text-t-primary break-words'>{file.name}</div>
          <div className='mt-3px flex items-center gap-6px flex-wrap text-11px text-t-tertiary'>
            <span className='px-6px rd-4px bg-[var(--color-fill-2)]'>{categoryName}</span>
            <span>{file.ext.toUpperCase()}</span>
            <span>{file.sizeText}</span>
          </div>
        </div>
      </div>

      <p className='m-0 text-12px leading-19px text-t-secondary flex-1'>{file.summary}</p>

      <div className='flex items-center gap-8px'>
        {previewable ? (
          <Button size='small' icon={<PreviewOpen size={13} />} onClick={onPreview} className='flex-1'>
            {t('common.tradeKnowledge.preview')}
          </Button>
        ) : (
          <Tooltip content={file.previewNote}>
            <Button size='small' icon={<PreviewOpen size={13} />} disabled className='flex-1'>
              {t('common.tradeKnowledge.preview')}
            </Button>
          </Tooltip>
        )}
        <Button
          size='small'
          type='primary'
          loading={busy}
          icon={<Download size={13} />}
          onClick={onDownload}
          className='flex-1'
        >
          {busy ? t('common.tradeKnowledge.downloading') : t('common.tradeKnowledge.download')}
        </Button>
      </div>
    </div>
  );
};

export default TradeKnowledgePage;
