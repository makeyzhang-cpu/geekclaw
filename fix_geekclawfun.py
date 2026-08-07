#!/usr/bin/env python3
"""
Fix broken replacements: geekclawfun → nomifun, GeekClawfun → Nomifun, etc.
These were caused by the 'use nomi' → 'use geekclaw' replacement matching 'use nomifun_*'.
"""
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))

EXTENSIONS = {
    '.rs', '.ts', '.tsx', '.js', '.jsx',
    '.json', '.html', '.css', '.toml',
    '.service', '.plist', '.webmanifest', '.svg',
    '.md', '.txt', '.scss', '.less'
}

SKIP_DIRS = {
    'node_modules', 'target', '.git', 'gen', 'icons_backup',
    '__pycache__', '.cache', 'dist', '.next', 'build.noindex'
}

# Fix patterns: geekclawfun → nomifun (all case variants)
FIXES = [
    ("geekclawfun", "nomifun"),
    ("GeekClawfun", "Nomifun"),
    ("geekclawlfun", "nomifun"),
    ("GeekClawlfun", "Nomifun"),
    ("Geekclawfun", "Nomifun"),
    ("geekClawfun", "nomifun"),
    # Also fix 'mod geekclawfun' → 'mod nomifun' if any
    # Also fix 'self::geekclawfun' → 'self::nomifun'
    # Also fix 'crate::geekclawfun' → 'crate::nomifun'
    # Also fix 'super::geekclawfun' → 'super::nomifun'
    # These are already covered by the string replacement above
]

def should_process(filepath):
    _, ext = os.path.splitext(filepath)
    return ext.lower() in EXTENSIONS

def should_skip_dir(dirname):
    return dirname in SKIP_DIRS

def main():
    total_files = 0
    modified_files = 0
    total_changes = 0

    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if not should_skip_dir(d)]

        for filename in filenames:
            filepath = os.path.join(dirpath, filename)
            if not should_process(filepath):
                continue

            total_files += 1

            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    original = f.read()
            except (UnicodeDecodeError, PermissionError, OSError):
                continue

            content = original
            changes = 0

            for old, new in FIXES:
                if old in content:
                    count = content.count(old)
                    content = content.replace(old, new)
                    changes += count

            if content != original:
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(content)
                modified_files += 1
                total_changes += changes
                rel_path = os.path.relpath(filepath, ROOT)
                # Only print first 20 modified files
                if modified_files <= 20:
                    print(f"  ✓ {rel_path} ({changes} changes)")

    print(f"\n{'='*60}")
    print(f"Scanned: {total_files} files")
    print(f"Modified: {modified_files} files")
    print(f"Total fixes: {total_changes}")
    print(f"{'='*60}")

if __name__ == '__main__':
    main()
