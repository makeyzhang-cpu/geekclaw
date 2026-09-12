# Renderer i18n

The renderer uses `i18next` + `react-i18next`. The source of truth lives in
`ui/src/renderer/services/i18n/`.

## Supported Languages

The picker offers 19 languages, declared in
`ui/src/common/config/i18n-config.json` (`supportedLanguages`):

| Code     | Language                        | Arco pack |
| -------- | ------------------------------- | --------- |
| `zh-CN`  | 简体中文                         | yes       |
| `zh-TW`  | 繁體中文                         | yes       |
| `en-US`  | English (reference language)     | yes       |
| `ja-JP`  | 日本語                           | yes       |
| `ko-KR`  | 한국어                           | yes       |
| `ru-RU`  | Русский                          | yes       |
| `es-ES`  | Español                          | yes       |
| `ar-SA`  | العربية (RTL)                    | via ar-EG |
| `id-ID`  | Bahasa Indonesia                 | yes       |
| `ms-MY`  | Bahasa Melayu                    | yes       |
| `th-TH`  | ไทย                              | yes       |
| `vi-VN`  | Tiếng Việt                       | yes       |
| `fil-PH` | Filipino                         | no        |
| `my-MM`  | မြန်မာ                            | no        |
| `km-KH`  | ខ្មែរ                             | no        |
| `lo-LA`  | ລາວ                              | no        |
| `ta-SG`  | தமிழ்                            | no        |
| `pt-TL`  | Português                        | via pt-PT |
| `tet-TL` | Tetun                            | no        |

`DEFAULT_LANGUAGE`, normalization, fallback merging, and the supported language
type are shared from `@/common/config/i18n`.

### Complete vs. in-progress languages

`completeLanguages` (same config file) lists the languages whose translations are
finished. **Only those are held to cross-locale key parity** by
`scripts/generate-i18n-types.mjs`.

A language outside that list ships an empty bundle — `export default {}` in
`locales/<code>/index.ts` — and falls back to the reference locale (`en-US`) at
runtime, so it can be selected in the picker before its strings land without
failing the build. Moving a code into `completeLanguages` is what switches the
parity gate on for it: from then on, a missing key is a build error.

## File Layout

```text
services/i18n/
├── index.ts            # bundle registry + runtime switch
├── i18n-keys.d.ts      # generated key types
├── localeKeyParity.ts  # the one cross-locale parity rule
└── locales/
    ├── index.ts → zh-CN/, en-US/   # complete: full module JSON
    └── …                           # in progress: index.ts only, `export default {}`
```

Locale JSON is split by module. Each locale folder exports its modules through
`locales/<lang>/index.ts`, and `services/i18n/index.ts` statically imports every
locale bundle so the packaged desktop app can switch languages without runtime
file discovery.

`i18n-keys.d.ts` is generated from the reference locale and exports `I18nKey` /
`I18nModule` for typed call sites.

## Runtime Flow

1. `i18n` initializes synchronously with the fallback locale to avoid a flash of
   untranslated content.
2. `localStorage.i18nextLng` is used only as a fast first-render hint.
3. `configService.whenReady()` loads the authoritative language from the
   backend config.
4. `ensureAndSwitch()` loads/merges the locale and calls i18next.
5. `changeLanguage()` writes the normalized language through `configService`,
   syncs `localStorage`, and notifies the host through
   `ipcBridge.systemSettings.changeLanguage`.
6. Other renderer surfaces receive language changes through
   `ipcBridge.systemSettings.languageChanged`.

Do not use `i18next-browser-languagedetector`: desktop WebView and WebUI run on
different origins, so browser-origin storage is not the source of truth.

## Usage

```tsx
import { useTranslation } from 'react-i18next';

export function SaveButton() {
  const { t } = useTranslation();
  return <button>{t('common.save')}</button>;
}
```

For language switching, use the shared helper:

```ts
import { changeLanguage, supportedLanguages } from '@/renderer/services/i18n';

await changeLanguage('en-US');
```

## Adding A Language

1. Add the code to `supportedLanguages` and a `languageLabels` entry
   (`native`, `english`, and `rtl: true` for right-to-left scripts) in
   `ui/src/common/config/i18n-config.json`.
2. Add any code alias the prefix matcher cannot infer — script subtags
   (`zh-Hant` → `zh-TW`) and retired ISO-639 codes (`in` → `id-ID`) — to
   `languageAliases`.
3. Create `locales/<code>/index.ts` containing `export default {};`.
4. Register the bundle in `services/i18n/index.ts` (a static `import` plus a
   `localeData` entry). The packaged app resolves locales at build time, so a
   runtime directory scan is not an option.
5. If Arco ships a pack for the language, import it in `renderer/main.tsx` and add
   an `arcoLocales` entry; otherwise it falls back to `en-US` there.
6. Nothing else: the titlebar menu, Settings › System and the login page all read
   `supportedLanguages`, so they pick the new language up automatically.

Then, to translate: add `locales/<code>/<module>.json` files, import them from
that locale's `index.ts`, and move the code into `completeLanguages` once every
namespace matches the reference key set.

## Checks

From the repository root:

```bash
bun scripts/generate-i18n-types.mjs           # regenerate i18n-keys.d.ts
bun scripts/generate-i18n-types.mjs --check   # verify it, plus cross-locale parity
bun scripts/generate-i18n-types.mjs --self-test
```

`--check` fails when the committed `i18n-keys.d.ts` drifts from the reference
locale, when a complete locale drops or adds a key, or when a supported language
has no loadable `locales/<code>/index.ts`.

## Plurals

i18next resolves `count` through a `_<category>` suffix (JSON v4), and the
categories differ per language. `localeKeyParity.ts` is the one implementation of
that rule. Both the `--check` gate and the per-namespace locale tests import it,
so neither can start demanding a variant the other forbids:

- a key with no plural suffix must exist in every **complete** locale (real
  drift, an error);
- a `_<category>` variant is required only of locales that have that category;
- a variant outside a locale's categories is reported as unreachable.

## Rules

- Do not hardcode user-visible product text in components.
- Do not hardcode the language list: read `supportedLanguages` / `LANGUAGE_LABELS`
  from `@/renderer/services/i18n`.
- Prefer stable semantic keys such as `cron.detail.runNow`.
- Keep complete locales' keys symmetric, except for plural variants (see
  [Plurals](#plurals)).
- Add a new module only when the feature boundary is real; otherwise extend the
  nearest existing module.
- Run the `--check` command above before submitting locale changes.
