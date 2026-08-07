#!/usr/bin/env python3
"""Fix all remaining nomi_* crate/module references to geekclaw_* in .rs files."""

import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))

SKIP_DIRS = {
    "target", ".git", "node_modules", "build.noindex", "dist", ".cache",
    ".svelte-kit", ".vite", "icons_backup"
}

# Ordered: longer names first to avoid partial matches
# (e.g., nomi_browser_engine before nomi_browser, nomi_process_runtime before nomi_protocol)
REPLACEMENTS = [
    # Two-word crate names first (longer)
    ("nomi_browser_engine", "geekclaw_browser_engine"),
    ("nomi_process_runtime", "geekclaw_process_runtime"),
    # Single-word crate names
    ("nomi_compact", "geekclaw_compact"),
    ("nomi_protocol", "geekclaw_protocol"),
    ("nomi_providers", "geekclaw_providers"),
    ("nomi_computer", "geekclaw_computer"),
    ("nomi_browser", "geekclaw_browser"),  # must come after nomi_browser_engine
    ("nomi_config", "geekclaw_config"),
    ("nomi_memory", "geekclaw_memory"),
    ("nomi_skills", "geekclaw_skills"),
    ("nomi_types", "geekclaw_types"),
    ("nomi_tools", "geekclaw_tools"),
    ("nomi_agent", "geekclaw_agent"),
    ("nomi_a11y", "geekclaw_a11y"),
    ("nomi_mcp", "geekclaw_mcp"),
    ("nomi_redact", "geekclaw_redact"),
]

def should_skip(path):
    parts = path.replace("\\", "/").split("/")
    for skip in SKIP_DIRS:
        if skip in parts:
            return True
    return False

def fix_file(filepath):
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception:
        return 0
    
    original = content
    changes = 0
    
    for old, new in REPLACEMENTS:
        # Use word boundary to avoid partial matches
        # In Rust, nomi_compact can appear as: nomi_compact::, "nomi_compact", nomi_compact::
        # Word boundary \b before nomi_ and after the full word
        pattern = r'\b' + re.escape(old) + r'\b'
        new_content, count = re.subn(pattern, new, content)
        if count > 0:
            content = new_content
            changes += count
    
    if content != original:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        return changes
    return 0

total_files = 0
total_changes = 0

for dirpath, dirnames, filenames in os.walk(ROOT):
    # Skip unwanted directories
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    
    for filename in filenames:
        if not filename.endswith(".rs"):
            continue
        filepath = os.path.join(dirpath, filename)
        if should_skip(filepath):
            continue
        changes = fix_file(filepath)
        if changes > 0:
            total_files += 1
            total_changes += changes
            print(f"  {os.path.relpath(filepath, ROOT)}: {changes} changes")

print(f"\nTotal: {total_files} files modified, {total_changes} changes")
