/**
 * vi-VN locale module index.
 *
 * Not translated yet: this bundle is intentionally empty, so every namespace
 * falls back to the reference locale (en-US) at runtime and switching to this
 * language shows English until strings land.
 *
 * To translate, add `import <name> from './<name>.json'` lines plus the matching
 * entries in the `export default { ... }` block below, then move the code into
 * `completeLanguages` in `ui/src/common/config/i18n-config.json` once every
 * namespace matches the reference locale's key set — that is what switches the
 * `check:i18n` parity gate on for it.
 */

export default {};
