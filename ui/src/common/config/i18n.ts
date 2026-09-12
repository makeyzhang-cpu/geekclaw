/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared i18n utility functions used by both main process and renderer.
 */

import i18nConfig from '@/common/config/i18n-config.json';

/** Every language the picker offers, in display order. */
export const SUPPORTED_LANGUAGES = i18nConfig.supportedLanguages;
export const DEFAULT_LANGUAGE = i18nConfig.fallbackLanguage;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Languages whose translations are complete. Only these are held to cross-locale
 * key parity by the `check:i18n` gate — a language that has not been translated
 * yet ships an empty bundle and falls back to `DEFAULT_LANGUAGE` at runtime, so
 * demanding its keys would block every build until the last string lands.
 */
export const COMPLETE_LANGUAGES: readonly SupportedLanguage[] = i18nConfig.completeLanguages;

/** Native + English display names (and RTL flag) for each shipped language. */
export interface LanguageLabel {
  /** Endonym — the language's own name, shown in the picker. */
  native: string;
  /** English name, used as the secondary line / fallback. */
  english: string;
  /** Right-to-left script. Informational for now; layout mirroring is separate. */
  rtl?: boolean;
}

export const LANGUAGE_LABELS: Record<string, LanguageLabel> = i18nConfig.languageLabels;

/**
 * Code aliases prefix matching cannot infer — script subtags and retired
 * ISO-639 codes (`zh-Hant` → zh-TW, `in` → id-ID). Sort longest-first so a
 * specific alias (`zh-Hant`) outranks a broader one it contains (`zh`).
 */
const ALIAS_ENTRIES: ReadonlyArray<[string, string]> = Object.entries(
  i18nConfig.languageAliases as Record<string, string>
).sort(([a], [b]) => b.length - a.length);

/** Lower-cased shipped tag → its canonical casing. */
const CANONICAL_BY_LOWER = new Map<string, SupportedLanguage>(
  SUPPORTED_LANGUAGES.map((code) => [code.toLowerCase(), code as SupportedLanguage])
);

/** Primary subtag → the default region we ship for it (`ja` → ja-JP). */
const BY_PRIMARY = new Map<string, SupportedLanguage>();
for (const code of SUPPORTED_LANGUAGES) {
  const primary = code.toLowerCase().split('-')[0];
  if (!BY_PRIMARY.has(primary)) BY_PRIMARY.set(primary, code as SupportedLanguage);
}

/**
 * Normalize a language code to a shipped BCP 47 tag. Resolution order, first hit
 * wins: exact tag (case-insensitive, `_` folded to `-`) → explicit alias →
 * primary subtag → fallback language.
 *
 * Unknown locales never pass through as-is: they collapse to the fallback, so
 * every caller can assume the result names a language this build actually ships.
 * e.g. 'zh_CN' → zh-CN, 'zh-Hant' → zh-TW, 'ja' → ja-JP, 'xx-YY' → en-US.
 */
export function normalizeLanguageCode(language: string): SupportedLanguage {
  const tag = (language ?? '').replace(/_/g, '-').trim();
  if (!tag) return DEFAULT_LANGUAGE;

  const exact = CANONICAL_BY_LOWER.get(tag.toLowerCase());
  if (exact) return exact;

  const lowered = tag.toLowerCase();
  for (const [alias, target] of ALIAS_ENTRIES) {
    const key = alias.toLowerCase();
    if (lowered !== key && !lowered.startsWith(`${key}-`)) continue;
    const resolved = CANONICAL_BY_LOWER.get(target.toLowerCase());
    if (resolved) return resolved;
  }

  return BY_PRIMARY.get(lowered.split('-')[0]) ?? DEFAULT_LANGUAGE;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge `target` into `fallback`, so that any key missing in `target`
 * falls back to the value in `fallback`.
 */
export function mergeWithFallback(
  fallback: Record<string, unknown>,
  target: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...fallback };

  for (const [key, value] of Object.entries(target)) {
    const fallbackValue = merged[key];
    if (isPlainObject(fallbackValue) && isPlainObject(value)) {
      merged[key] = mergeWithFallback(fallbackValue, value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

export type LocaleData = Record<string, Record<string, unknown>>;

/**
 * Ensure a resource bundle is loaded, then switch i18next to the given language.
 * Deduplicates the "load-if-missing + changeLanguage" pattern.
 */
export async function ensureAndSwitch(
  i18n: {
    hasResourceBundle: (lng: string, ns: string) => boolean;
    addResourceBundle: (lng: string, ns: string, resources: unknown, deep?: boolean, overwrite?: boolean) => unknown;
    changeLanguage: (lng: string) => Promise<unknown> | unknown;
  },
  lang: string,
  getTranslation: (locale: string) => Record<string, unknown> | Promise<Record<string, unknown>>
): Promise<void> {
  const normalizedLang = normalizeLanguageCode(lang);
  if (!i18n.hasResourceBundle(normalizedLang, 'translation')) {
    const translation = await getTranslation(normalizedLang);
    i18n.addResourceBundle(normalizedLang, 'translation', translation, true, true);
  }
  await i18n.changeLanguage(normalizedLang);
}
