#!/usr/bin/env python3
"""Comprehensive nomifun -> geekclaw rebrand for user-visible strings.

Protects:
  - Backend crate names (nomifun-app, nomifun-common, ...) — from Cargo.toml `name =`
  - Backend crate directory names (nomifun-webhook, ...) — even if crate renamed
  - Module paths (nomifun_app::, nomifun_common::, any nomifun_<word>) — never touched

Replaces (user-visible only):
  - nomifun- (hyphen, non-crate) -> geekclaw-  (nomifun-skills, nomifun-tauri, nomifun-data, ...)
  - bare nomifun -> geekclaw  (nomifun.com, /var/lib/nomifun, docker user, ...)
  - __nomifun_ -> __geekclaw_  (localStorage keys)
  - NomiFun -> GeekClaw
  - NOMIFUN -> GEEKCLAW  (env vars)
"""
import os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))

SKIP_DIRS = {".git", "target", "node_modules", "build.noindex", "dist", ".next", "__pycache__"}
SKIP_FILES = {"fix_remaining_docs.py", "fix_data_dirs.py", "fix_geekclawfun.py", "replace_nomi.py", "fix_all_nomifun.py"}
SKIP_EXT = {".lock", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".woff", ".woff2", ".ttf", ".eot",
            ".mp4", ".webm", ".webp", ".pdf", ".zip", ".gz", ".exe", ".dll", ".so", ".dylib", ".bin"}

# ---- Build protect list (hyphen form) ----
protect_hyphen = set()

# 1) directory names under crates/ that start with nomifun-
for base, dirs, _files in os.walk(os.path.join(ROOT, "crates")):
    dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
    for d in dirs:
        if d.startswith("nomifun-"):
            protect_hyphen.add(d)

# 2) crate names from Cargo.toml `name = "nomifun-*"` in crates/ and apps/
for sub in ("crates", "apps"):
    for base, dirs, files in os.walk(os.path.join(ROOT, sub)):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        if "Cargo.toml" in files:
            try:
                txt = open(os.path.join(base, "Cargo.toml"), encoding="utf-8", errors="ignore").read()
            except Exception:
                continue
            for m in re.finditer(r'name\s*=\s*"(nomifun-[a-z0-9_-]+)"', txt):
                protect_hyphen.add(m.group(1))

# 3) manual fallback
protect_hyphen.update([
    "nomifun-app","nomifun-db","nomifun-api-types","nomifun-auth","nomifun-conversation",
    "nomifun-ai-agent","nomifun-mcp","nomifun-extension","nomifun-requirement","nomifun-terminal",
    "nomifun-companion","nomifun-gateway","nomifun-public","nomifun-common","nomifun-runtime",
    "nomifun-knowledge","nomifun-webhook","nomifun-cron","nomifun-creation","nomifun-workshop",
    "nomifun-system","nomifun-assets","nomifun-agent-execution","nomifun-net","nomifun-realtime",
    "nomifun-file","nomifun-office","nomifun-shell","nomifun-model-invoke","nomifun-channel",
    "nomifun-idmm","nomifun-preset","nomifun-secret","nomifun-customer-service","nomifun-browser-platform",
])

# underscore forms (module paths) — also protect explicitly
protect_under = set(h.replace("-", "_") for h in protect_hyphen)

print(f"Protect list ({len(protect_hyphen)} tokens):", sorted(protect_hyphen)[:10], "...", file=sys.stderr)

# ---- Processing function ----
def process(text):
    masks = {}
    counter = [0]

    def make_ph(label):
        ph = f"\x00M{counter[0]}{label}\x00"
        counter[0] += 1
        return ph

    # 1) mask protected hyphen forms (longest first to avoid partial matches)
    for tok in sorted(protect_hyphen, key=len, reverse=True):
        if tok in text:
            ph = make_ph("H")
            text = text.replace(tok, ph)
            masks[ph] = tok

    # 2) mask protected underscore forms
    for tok in sorted(protect_under, key=len, reverse=True):
        if tok in text:
            ph = make_ph("U")
            text = text.replace(tok, ph)
            masks[ph] = tok

    # 3) mask ALL remaining nomifun_<word> (module paths — never change)
    def mask_modpath(m):
        ph = make_ph("W")
        masks[ph] = m.group(0)
        return ph
    text = re.sub(r'nomifun_[a-zA-Z0-9_]+', mask_modpath, text)

    # 4) explicit: localStorage keys __nomifun_ -> __geekclaw_
    text = text.replace("__nomifun_", "__geekclaw_")

    # 5) replace hyphen forms (user-facing): nomifun- -> geekclaw-
    text = text.replace("nomifun-", "geekclaw-")

    # 6) replace bare nomifun (word boundary) -> geekclaw
    text = re.sub(r'\bnomifun\b', 'geekclaw', text)

    # 7) case variants
    text = text.replace("NomiFun", "GeekClaw")
    text = text.replace("NOMIFUN", "GEEKCLAW")

    # 8) unmask
    for ph, tok in masks.items():
        text = text.replace(ph, tok)

    return text


# ---- Walk and process ----
changed_files = []
total_replacements = 0

for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for fn in filenames:
        if fn in SKIP_FILES:
            continue
        ext = os.path.splitext(fn)[1].lower()
        if ext in SKIP_EXT:
            continue
        path = os.path.join(dirpath, fn)
        try:
            with open(path, "rb") as f:
                raw = f.read(8192)
            if b"\x00" in raw:  # binary file
                continue
            with open(path, encoding="utf-8", newline="") as f:
                orig = f.read()
        except Exception:
            continue
        if "nomifun" not in orig.lower():
            continue
        new = process(orig)
        if new != orig:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(new)
            diffs = sum(1 for a, b in zip(orig, new) if a != b)
            changed_files.append((os.path.relpath(path, ROOT), diffs))
            total_replacements += diffs

print(f"\nChanged {len(changed_files)} files, ~{total_replacements} char-level diffs:", file=sys.stderr)
for p, d in changed_files:
    print(f"  {p} ({d})", file=sys.stderr)
