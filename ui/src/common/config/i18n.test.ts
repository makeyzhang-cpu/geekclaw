/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test } from 'bun:test';
import { COMPLETE_LANGUAGES, DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, normalizeLanguageCode } from './i18n';

describe('i18n language support', () => {
  test('ships every picker language and keeps English as the fallback', () => {
    expect(DEFAULT_LANGUAGE).toBe('en-US');
    expect(SUPPORTED_LANGUAGES.length).toBeGreaterThan(2);
    for (const code of [
      'zh-CN',
      'zh-TW',
      'en-US',
      'ja-JP',
      'ko-KR',
      'ru-RU',
      'es-ES',
      'ar-SA',
      'id-ID',
      'ms-MY',
      'th-TH',
      'vi-VN',
      'fil-PH',
      'my-MM',
      'km-KH',
      'lo-LA',
      'ta-SG',
      'pt-TL',
      'tet-TL',
    ]) {
      expect(SUPPORTED_LANGUAGES.includes(code)).toBe(true);
    }
  });

  test('completeLanguages stays a subset of the shipped set and holds the reference', () => {
    expect(COMPLETE_LANGUAGES.length).toBeGreaterThan(0);
    for (const code of COMPLETE_LANGUAGES) {
      expect(SUPPORTED_LANGUAGES.includes(code)).toBe(true);
    }
    expect(COMPLETE_LANGUAGES.includes(DEFAULT_LANGUAGE)).toBe(true);
  });

  test('accepts exact tags regardless of case and separator', () => {
    expect(normalizeLanguageCode('zh-CN')).toBe('zh-CN');
    expect(normalizeLanguageCode('zh_CN')).toBe('zh-CN');
    expect(normalizeLanguageCode('ZH-cn')).toBe('zh-CN');
    expect(normalizeLanguageCode('JA-jp')).toBe('ja-JP');
    expect(normalizeLanguageCode('ar-SA')).toBe('ar-SA');
  });

  test('folds Chinese script and region variants onto the shipped tags', () => {
    expect(normalizeLanguageCode('zh-TW')).toBe('zh-TW');
    expect(normalizeLanguageCode('zh-Hant')).toBe('zh-TW');
    expect(normalizeLanguageCode('zh-Hant-TW')).toBe('zh-TW');
    expect(normalizeLanguageCode('zh-HK')).toBe('zh-TW');
    expect(normalizeLanguageCode('zh-Hans')).toBe('zh-CN');
    expect(normalizeLanguageCode('zh')).toBe('zh-CN');
  });

  test('resolves a bare language subtag to its shipped region', () => {
    expect(normalizeLanguageCode('ja')).toBe('ja-JP');
    expect(normalizeLanguageCode('ko')).toBe('ko-KR');
    expect(normalizeLanguageCode('th')).toBe('th-TH');
    expect(normalizeLanguageCode('my')).toBe('my-MM');
    expect(normalizeLanguageCode('id')).toBe('id-ID');
    // Retired ISO-639 code for Indonesian, still emitted by older clients.
    expect(normalizeLanguageCode('in')).toBe('id-ID');
  });

  test('collapses unsupported and malformed tags onto the fallback', () => {
    expect(normalizeLanguageCode('tr-TR')).toBe(DEFAULT_LANGUAGE);
    expect(normalizeLanguageCode('uk-UA')).toBe(DEFAULT_LANGUAGE);
    expect(normalizeLanguageCode('fr-FR')).toBe(DEFAULT_LANGUAGE);
    expect(normalizeLanguageCode('')).toBe(DEFAULT_LANGUAGE);
  });
});
