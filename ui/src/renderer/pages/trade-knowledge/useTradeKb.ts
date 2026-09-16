/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';

/** `ui/public/trade-kb/` 随前端一起打包的静态资源根路径。 */
export const TRADE_KB_BASE = '/trade-kb/';

export type TradeKbKind = 'excel' | 'word' | 'ppt' | 'other';

export interface TradeKbFile {
  id: string;
  /** 原始文件名（下载时保持原样）。 */
  name: string;
  ext: string;
  kind: TradeKbKind;
  size: number;
  sizeText: string;
  /** 分类 id，对应 manifest.categories[].id。 */
  category: string;
  /** 一句话说明：这份模板解决什么问题。 */
  summary: string;
  /** 下载地址（相对 trade-kb 根，已 URL 编码）。 */
  href: string;
  /** 在线查阅页面；null 表示该格式不支持预览。 */
  preview: string | null;
  /** 预览不可用时的提示文案。 */
  previewNote: string;
}

export interface TradeKbCategory {
  id: string;
  name: string;
  icon: string;
  order: number;
}

export interface TradeKbManifest {
  version: number;
  source: string;
  generatedAt: string;
  stats: {
    files: number;
    bytes: number;
    bytesText: string;
    categories: number;
    previewable: number;
  };
  categories: TradeKbCategory[];
  files: TradeKbFile[];
}

type LoadState =
  | { status: 'loading'; manifest: null; error: null }
  | { status: 'ready'; manifest: TradeKbManifest; error: null }
  | { status: 'error'; manifest: null; error: string };

/**
 * 读取内置知识库清单。
 *
 * 清单由 `scripts/build-trade-kb.py` 在构建期生成，随前端一起打包，
 * 因此这里只是一次同源静态请求，不依赖后端服务。
 */
export function useTradeKbManifest() {
  const [state, setState] = useState<LoadState>({ status: 'loading', manifest: null, error: null });

  const load = useCallback(async () => {
    setState({ status: 'loading', manifest: null, error: null });
    try {
      const response = await fetch(`${TRADE_KB_BASE}manifest.json`, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = (await response.json()) as TradeKbManifest;
      if (!manifest || !Array.isArray(manifest.files)) throw new Error('malformed manifest');
      setState({ status: 'ready', manifest, error: null });
    } catch (error) {
      setState({
        status: 'error',
        manifest: null,
        error: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: load };
}

/**
 * 触发浏览器下载。
 *
 * 优先把文件取成 Blob 再走 `<a download>`（Tauri 打包后仍能正确落地并保留原文件名）；
 * 若当前运行环境不支持对该协议 fetch，则退化为直接导航到资源地址。
 */
export async function downloadTradeKbFile(file: TradeKbFile): Promise<void> {
  const url = `${TRADE_KB_BASE}${file.href}`;
  const save = (blob: Blob) => {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  };

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    save(await response.blob());
  } catch {
    // 退化路径：直接让浏览器按 save 语义处理该地址。
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
