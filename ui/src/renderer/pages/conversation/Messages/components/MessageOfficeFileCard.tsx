/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IOfficeFileArtifact } from '@/common/adapter/ipcBridge';
import { ipcBridge } from '@/common';
import { usePreviewContext } from '@renderer/pages/conversation/Preview';
import { downloadFileFromPath } from '@/renderer/utils/file/download';
import { iconColors } from '@/renderer/styles/colors';
import { Download, FileExcel, FilePpt, FileWord, PreviewOpen } from '@icon-park/react';
import { Button, Message as ArcoMessage } from '@arco-design/web-react';
import React, { useMemo, useState } from 'react';

const formatBytes = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

const MessageOfficeFileCard: React.FC<{ artifact: IOfficeFileArtifact }> = ({ artifact }) => {
  const { openPreview } = usePreviewContext();
  const [previewing, setPreviewing] = useState(false);

  const { file_path, workspace, name, extension, size_bytes } = artifact.payload;
  const ext = (extension ?? name.split('.').pop() ?? '').toLowerCase();

  const icon = useMemo(() => {
    if (ext === 'xlsx') return <FileExcel theme='outline' size={20} fill={iconColors.secondary} />;
    if (ext === 'pptx') return <FilePpt theme='outline' size={20} fill={iconColors.secondary} />;
    return <FileWord theme='outline' size={20} fill={iconColors.secondary} />;
  }, [ext]);

  const handlePreview = async (): Promise<void> => {
    if (!file_path) return;
    setPreviewing(true);
    try {
      const api =
        ext === 'xlsx'
          ? ipcBridge.excelPreview
          : ext === 'pptx'
            ? ipcBridge.pptPreview
            : ipcBridge.wordPreview;
      const res = await api.start.invoke({ file_path, workspace });
      const url = res?.url;
      if (!url) {
        ArcoMessage.error('预览地址获取失败');
        return;
      }
      openPreview(url, 'url', { title: name, file_name: name, workspace });
    } catch (error) {
      ArcoMessage.error(`预览失败：${(error as Error)?.message ?? String(error)}`);
    } finally {
      setPreviewing(false);
    }
  };

  const handleDownload = async (): Promise<void> => {
    if (!file_path) return;
    try {
      await downloadFileFromPath(file_path, name, workspace);
    } catch (error) {
      ArcoMessage.error(`下载失败：${(error as Error)?.message ?? String(error)}`);
    }
  };

  return (
    <div data-testid='message-office-file' className='max-w-780px w-full mx-auto'>
      <div
        className='flex items-center gap-12px px-16px py-12px rd-12px b-1px b-solid bg-fill-0 hover:bg-fill-1 transition-colors'
        style={{ borderColor: 'color-mix(in srgb, var(--color-border-2) 70%, transparent)' }}
      >
        <div className='flex items-center justify-center w-40px h-40px rounded-10px bg-fill-2 shrink-0'>
          {icon}
        </div>
        <div className='flex-1 min-w-0'>
          <div className='text-14px font-500 text-t-primary truncate' title={name}>
            {name}
          </div>
          <div className='mt-2px text-12px text-t-secondary'>
            {ext.toUpperCase() || 'OFFICE'} · {formatBytes(size_bytes)}
          </div>
        </div>
        <div className='flex items-center gap-8px shrink-0'>
          <Button
            type='outline'
            size='mini'
            className='!rounded-10px'
            loading={previewing}
            onClick={handlePreview}
          >
            <span className='inline-flex items-center gap-4px'>
              <PreviewOpen theme='outline' size={14} />
              预览
            </span>
          </Button>
          <Button type='primary' size='mini' className='!rounded-10px' onClick={handleDownload}>
            <span className='inline-flex items-center gap-4px'>
              <Download theme='outline' size={14} />
              下载到本地
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default MessageOfficeFileCard;
