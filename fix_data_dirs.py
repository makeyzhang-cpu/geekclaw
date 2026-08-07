#!/usr/bin/env python3
"""
Replace all remaining `nomifun` / `NomiFun` references with `geekclaw` / `GeekClaw`.
Covers: data directories, env vars, app identifiers, CSS classes, event names,
cookie names, localStorage keys, website URLs, MCP server names, copyright headers, etc.

Does NOT touch backend crate names (nomifun-app, nomifun-common, etc.) or
Rust module paths (nomifun_app::, nomifun_runtime::, nomifun_knowledge::).
"""

import os

ROOT = os.path.dirname(os.path.abspath(__file__))

SKIP_DIRS = {
    "target", "node_modules", ".git", "build.noindex", "ui/dist",
    ".vscode", ".idea", "__pycache__",
}

SKIP_FILES = {
    "fix_nomi_refs.py", "fix_geekclawfun.py", "replace_nomi.py",
    "fix_data_dirs.py", "fix_data_dirs_v2.py",
}

# (old, new, skip_cargo_toml)
# Ordered: most specific / longest first.
REPLACEMENTS = [
    # --- Filesystem dot-prefixed paths (catches .nomifun, .nomifun-server, .nomifun-* etc.) ---
    (".nomifun", ".geekclaw", False),

    # --- Website domain (without dot prefix, e.g. copyright "(nomifun.com)") ---
    ("nomifun.com", "geekclaw.com", False),

    # --- Brand name (copyright headers, LOCALAPPDATA dir name, etc.) ---
    ("NomiFun", "GeekClaw", False),

    # --- Environment variables ---
    ("NOMIFUN_", "GEEKCLAW_", False),
    ("NOMI_KB_MCP_CAPABILITY", "GEEKCLAW_KB_MCP_CAPABILITY", False),

    # --- App identifiers (reverse domain) ---
    ("com.nomifun.", "com.geekclaw.", False),

    # --- localStorage keys ---
    ("__nomifun_", "__geekclaw_", False),

    # --- URL scheme ---
    ("nomifun://", "geekclaw://", False),

    # --- CSS classes ---
    ("nomifun-steps", "geekclaw-steps", False),
    ("nomifun-modal", "geekclaw-modal", False),
    ("nomifun-file-picker", "geekclaw-file-picker", False),
    ("nomifun-message-passthrough", "geekclaw-message-passthrough", False),

    # --- Event names ---
    ("nomifun-bridge-adapter", "geekclaw-bridge-adapter", False),
    ("nomifun-workspace-", "geekclaw-workspace-", False),
    ("nomifun-session-sider-", "geekclaw-session-sider-", False),
    ("nomifun-open-update-modal", "geekclaw-open-update-modal", False),

    # --- Cookie name ---
    ("nomifun-csrf-token", "geekclaw-csrf-token", False),

    # --- Model platform ---
    ("nomifun-free-model", "geekclaw-free-model", False),

    # --- Test temp dirs ---
    ("nomifun-artifacts", "geekclaw-artifacts", False),
    ("nomifun-image-gen-", "geekclaw-image-gen-", False),
    ("nomifun-logs", "geekclaw-logs", False),

    # --- MCP tool name pattern ---
    ("nomifun-desktop", "geekclaw-desktop", False),

    # --- Lock prefix ---
    ("nomifun-runtime-locks-", "geekclaw-runtime-locks-", False),

    # --- MCP server name (skip Cargo.toml — crate name stays unchanged) ---
    ("nomifun-knowledge", "geekclaw-knowledge", True),

    # --- Extension engine field access ---
    ("engine.nomifun", "engine.geekclaw", False),

    # --- i18n specific patterns ---
    ('"nomifun": "应用"', '"geekclaw": "应用"', False),
    ('"nomifun": "App"', '"geekclaw": "App"', False),
    ('ownership.nomifun', 'ownership.geekclaw', False),

    # --- Tauri URL scheme ---
    ('"schemes": ["nomifun"]', '"schemes": ["geekclaw"]', False),
]

# JSON-only replacements (applied to .json/.json5 files only)
JSON_REPLACEMENTS = [
    ('"nomifun"', '"geekclaw"'),
]

total_changes = 0
total_files = 0


def should_skip_dir(dirpath):
    parts = dirpath.replace("\\", "/").split("/")
    for part in parts:
        if part in SKIP_DIRS:
            return True
    return False


def process_file(filepath):
    global total_changes

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
    except (UnicodeDecodeError, PermissionError):
        return 0

    # Quick check
    if "nomifun" not in content.lower() and "NomiFun" not in content:
        return 0

    original = content
    is_cargo_toml = filepath.endswith("Cargo.toml")
    is_json = filepath.endswith((".json", ".json5"))

    changes = 0

    for old, new, skip_cargo in REPLACEMENTS:
        if skip_cargo and is_cargo_toml:
            continue
        if old in content:
            c = content.count(old)
            changes += c
            content = content.replace(old, new)

    # JSON-only replacements
    if is_json:
        for old, new in JSON_REPLACEMENTS:
            if old in content:
                c = content.count(old)
                changes += c
                content = content.replace(old, new)

    if content != original:
        try:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            return changes
        except PermissionError:
            return 0
    return 0


def walk_and_process():
    global total_changes, total_files

    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        if should_skip_dir(dirpath):
            continue

        for filename in filenames:
            if filename in SKIP_FILES:
                continue
            if filename.endswith((".py", ".pyc")):
                continue

            filepath = os.path.join(dirpath, filename)
            changes = process_file(filepath)
            if changes > 0:
                total_files += 1
                total_changes += changes
                rel = os.path.relpath(filepath, ROOT)
                print(f"  {rel}: {changes} changes")

    print(f"\nDone: {total_changes} changes in {total_files} files")


if __name__ == "__main__":
    print("Replacing nomifun/NomiFun -> geekclaw/GeekClaw (data dirs, env vars, etc.)...")
    walk_and_process()
