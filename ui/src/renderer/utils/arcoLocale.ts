/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Arco Design keeps its own component-level strings (date pickers, pagination,
 * modal buttons, empty states) separate from our locale bundles, so every
 * language we ship needs the matching pack handed to `ConfigProvider`.
 *
 * Arco ships no pack for Filipino, Burmese, Khmer, Lao, Tamil or Tetum — those
 * fall back to `en-US` below — and none for `ar-SA` / `pt-TL` either, so Arabic
 * and East-Timorese Portuguese borrow the closest packs it does ship
 * (`ar-EG`, `pt-PT`).
 *
 * Shared by the app shell (`renderer/main.tsx`) and the standalone image-editor
 * modal, which renders its own `ConfigProvider` outside the shell tree.
 */

import arEG from '@arco-design/web-react/es/locale/ar-EG';
import enUS from '@arco-design/web-react/es/locale/en-US';
import esES from '@arco-design/web-react/es/locale/es-ES';
import idID from '@arco-design/web-react/es/locale/id-ID';
import jaJP from '@arco-design/web-react/es/locale/ja-JP';
import koKR from '@arco-design/web-react/es/locale/ko-KR';
import msMY from '@arco-design/web-react/es/locale/ms-MY';
import ptPT from '@arco-design/web-react/es/locale/pt-PT';
import ruRU from '@arco-design/web-react/es/locale/ru-RU';
import thTH from '@arco-design/web-react/es/locale/th-TH';
import viVN from '@arco-design/web-react/es/locale/vi-VN';
import zhCN from '@arco-design/web-react/es/locale/zh-CN';
import zhTW from '@arco-design/web-react/es/locale/zh-TW';

export type ArcoLocale = typeof enUS;

/**
 * Arco's per-language packs are not structurally identical — several ship only a
 * partial set of component strings (e.g. no `Form` / `ColorPicker`) — so the map
 * is typed loosely and narrowed once at the boundary in `arcoLocaleFor`.
 */
const ARCO_LOCALES: Record<string, object> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-US': enUS,
  'ja-JP': jaJP,
  'ko-KR': koKR,
  'ru-RU': ruRU,
  'es-ES': esES,
  'ar-SA': arEG,
  'id-ID': idID,
  'ms-MY': msMY,
  'th-TH': thTH,
  'vi-VN': viVN,
  'pt-TL': ptPT,
};

/**
 * Arco's locale pack for a shipped language, or `en-US` when Arco has none.
 *
 * The cast is where the structural difference between packs is absorbed: the map
 * above is deliberately loose, while `ConfigProvider` wants a full `Locale` —
 * which every fallback path (and `en-US` itself) satisfies.
 */
export const arcoLocaleFor = (language: string): ArcoLocale =>
  (ARCO_LOCALES[language] ?? enUS) as ArcoLocale;
