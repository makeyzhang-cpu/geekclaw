#!/usr/bin/env python3
"""Fix remaining nomifun references in documentation and config files."""

import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))

# Files to process and their specific replacements
# Each entry: (file_path, [(old, new), ...])
file_replacements = {
    # === packaging/linux/README.md ===
    "packaging/linux/README.md": [
        # Docker compose service name
        ("docker compose logs -f nomifun", "docker compose logs -f geekclaw"),
        ("在 nomifun 的 environment", "在 geekclaw 的 environment"),
        ("把 nomifun 的 ports", "把 geekclaw 的 ports"),
        # System paths
        ("/opt/nomifun/", "/opt/geekclaw/"),
        ("/opt/nomifun\n", "/opt/geekclaw\n"),
        ("/var/lib/nomifun/", "/var/lib/geekclaw/"),
        ("/var/lib/nomifun ", "/var/lib/geekclaw "),
        ("/var/lib/nomifun\"", "/var/lib/geekclaw\""),
        ("/var/lib/nomifun\n", "/var/lib/geekclaw\n"),
        # User account
        ("--home /var/lib/geekclaw --shell /usr/sbin/nologin nomifun", "--home /var/lib/geekclaw --shell /usr/sbin/nologin geekclaw"),
        ("sudo -u nomifun", "sudo -u geekclaw"),
        ("~nomifun", "~geekclaw"),
        ("`nomifun` 是 nologin", "`geekclaw` 是 nologin"),
        # StateDirectory
        ("StateDirectory=nomifun", "StateDirectory=geekclaw"),
        # Command examples
        ("--data-dir /var/lib/geekclaw --dist /opt/geekclaw/web", "--data-dir /var/lib/geekclaw --dist /opt/geekclaw/web"),
    ],

    # === README.md ===
    "README.md": [
        # GitHub URLs
        ("github.com/nomifun/nomifun-tauri", "github.com/geekclaw/geekclaw-tauri"),
        # Docker image
        ("nomifun/geekclaw-web", "geekclaw/geekclaw-web"),
        # Clone instructions
        ("nomifun-tauri.git", "geekclaw-tauri.git"),
        ("cd nomifun-tauri", "cd geekclaw-tauri"),
        # Docker compose service name
        ("  nomifun:\n", "  geekclaw:\n"),
        # Product name note - update to reflect current state
        ("> The product name is **GeekClaw**. Lowercase `nomifun` is used only for code identifiers, crate names, environment variables, and repository paths.",
         "> The product name is **GeekClaw**. Some internal Rust crate names still use `nomifun-` prefixes for historical compatibility."),
        # Baidu share name - keep as is (external reference)
    ],

    # === README.zh-CN.md ===
    "README.zh-CN.md": [
        # GitHub URLs
        ("github.com/nomifun/nomifun-tauri", "github.com/geekclaw/geekclaw-tauri"),
        # Docker image
        ("nomifun/geekclaw-web", "geekclaw/geekclaw-web"),
        # Clone instructions
        ("nomifun-tauri.git", "geekclaw-tauri.git"),
        ("cd nomifun-tauri", "cd geekclaw-tauri"),
        # Docker compose service name
        ("  nomifun:\n", "  geekclaw:\n"),
        # Product name note
        ("> 产品名是 **GeekClaw**；小写 `nomifun` 仅用于代码标识符、crate 名、环境变量与仓库路径。",
         "> 产品名是 **GeekClaw**；部分内部 Rust crate 名仍使用 `nomifun-` 前缀，以保持历史兼容。"),
    ],

    # === RELEASING.md ===
    "RELEASING.md": [
        # GitHub URLs
        ("github.com/nomifun/nomifun-tauri", "github.com/geekclaw/geekclaw-tauri"),
        # Git author name
        ("commits as `nomifun`", "commits as `geekclaw`"),
        ("as author `nomifun`", "as author `geekclaw`"),
    ],

    # === RELEASING.zh-CN.md ===
    "RELEASING.zh-CN.md": [
        # GitHub URLs
        ("github.com/nomifun/nomifun-tauri", "github.com/geekclaw/geekclaw-tauri"),
        # Git author name
        ("再以 `nomifun`", "再以 `geekclaw`"),
        ("以 `nomifun` 提交", "以 `geekclaw` 提交"),
    ],
}

total_changes = 0
files_changed = 0

for rel_path, replacements in file_replacements.items():
    abs_path = os.path.join(ROOT, rel_path)
    if not os.path.exists(abs_path):
        print(f"SKIP (not found): {rel_path}")
        continue

    with open(abs_path, "r", encoding="utf-8") as f:
        content = f.read()

    original = content
    file_changes = 0

    for old, new in replacements:
        if old == new:
            continue
        count = content.count(old)
        if count > 0:
            content = content.replace(old, new)
            file_changes += count
            print(f"  [{rel_path}] {count}x: {old[:60]}... -> {new[:60]}...")

    if content != original:
        with open(abs_path, "w", encoding="utf-8") as f:
            f.write(content)
        files_changed += 1
        total_changes += file_changes
        print(f"  => {rel_path}: {file_changes} replacements written")
    else:
        print(f"  => {rel_path}: no changes needed")

print(f"\n=== Done: {total_changes} replacements in {files_changed} files ===")
