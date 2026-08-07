#!/usr/bin/env python3
"""
Bulk replace all "Nomi" (standalone, not NomiFun/Nomifun) references with "GeekClaw".
Handles: crate names, enum variants, module paths, binary names, conversation types,
variable names, comments, strings, logo file references, etc.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))

# File extensions to process
EXTENSIONS = {
    '.rs', '.ts', '.tsx', '.js', '.jsx',
    '.json', '.html', '.css', '.toml',
    '.service', '.plist', '.webmanifest', '.svg',
    '.md', '.txt', '.scss', '.less'
}

# Directories to skip
SKIP_DIRS = {
    'node_modules', 'target', '.git', 'gen', 'icons_backup',
    '__pycache__', '.cache', 'dist', '.next'
}

# ──────────────────────────────────────────────────────────
# Ordered exact-string replacements (most specific first)
# ──────────────────────────────────────────────────────────
ORDERED_REPLACEMENTS = [
    # ── Compound Rust identifiers ──
    ("NomiAgentManager", "GeekClawAgentManager"),
    ("AgentType::Nomi", "AgentType::GeekClaw"),
    ("AgentRuntimeHandle::Nomi", "AgentRuntimeHandle::GeekClaw"),
    ("McpSource::Nomi", "McpSource::GeekClaw"),
    ("McpSource::Nomifun", "McpSource::GeekClawPlatform"),
    ("ConversationSource::Nomifun", "ConversationSource::GeekClaw"),

    # ── Compound TypeScript identifiers ──
    ("isNomi", "isGeekClaw"),
    ("useNomiQuickStart", "useGeekClawQuickStart"),
    ("NomiRouter", "GeekClawRouter"),

    # ── Crate names with hyphens (TOML, text) ──
    ("nomi-a11y", "geekclaw-a11y"),
    ("nomi-browser-engine", "geekclaw-browser-engine"),
    ("nomi-browser", "geekclaw-browser"),
    ("nomi-computer", "geekclaw-computer"),
    ("nomi-cli", "geekclaw-cli"),
    ("nomi-config", "geekclaw-config"),
    ("nomi-mcp", "geekclaw-mcp"),
    ("nomi-memory", "geekclaw-memory"),
    ("nomi-providers", "geekclaw-providers"),
    ("nomi-skills", "geekclaw-skills"),
    ("nomi-tools", "geekclaw-tools"),
    ("nomi-types", "geekclaw-types"),
    ("nomi-process-runtime", "geekclaw-process-runtime"),

    # ── Crate names with underscores (Rust use statements) ──
    ("nomi_a11y", "geekclaw_a11y"),
    ("nomi_browser_engine", "geekclaw_browser_engine"),
    ("nomi_browser", "geekclaw_browser"),
    ("nomi_computer", "geekclaw_computer"),
    ("nomi_cli", "geekclaw_cli"),
    ("nomi_config", "geekclaw_config"),
    ("nomi_mcp", "geekclaw_mcp"),
    ("nomi_memory", "geekclaw_memory"),
    ("nomi_providers", "geekclaw_providers"),
    ("nomi_skills", "geekclaw_skills"),
    ("nomi_tools", "geekclaw_tools"),
    ("nomi_types", "geekclaw_types"),
    ("nomi_process_runtime", "geekclaw_process_runtime"),

    # ── Binary name ──
    ("nomicore", "geekclaw"),

    # ── Module paths and declarations ──
    # These must come AFTER crate underscore replacements
    ("mod nomi", "mod geekclaw"),
    ("nomi::", "geekclaw::"),
    ("use nomi", "use geekclaw"),
    ("self::nomi", "self::geekclaw"),
    ("crate::nomi", "crate::geekclaw"),
    ("super::nomi", "super::geekclaw"),

    # ── Logo file ──
    ("nomi.svg", "geekclaw.svg"),

    # ── Hidden directory (.nomi/) ──
    ('.nomi/', '.geekclaw/'),
    ('.nomi"', '.geekclaw"'),
    (".nomi'", ".geekclaw'"),
    ('.nomi\\', '.geekclaw\\'),

    # ── Serde values (quoted strings) — must come before regex pass ──
    ('"nomi"', '"geekclaw"'),
    ("'nomi'", "'geekclaw'"),

    # ── Git author/committer ──
    ('"Nomi"', '"GeekClaw"'),

    # ── Native Nomi compound ──
    ("Native Nomi", "Native GeekClaw"),

    # ── Common "Nomi X" compounds in strings/comments ──
    ("Nomi agent", "GeekClaw agent"),
    ("Nomi Agent", "GeekClaw Agent"),
    ("Nomi runtime", "GeekClaw runtime"),
    ("Nomi session", "GeekClaw session"),
    ("Nomi engine", "GeekClaw engine"),
    ("Nomi's", "GeekClaw's"),
    ("Nomi callers", "GeekClaw callers"),
    ("Nomi persists", "GeekClaw persists"),
    ("Nomi remains", "GeekClaw remains"),
    ("Nomi receives", "GeekClaw receives"),
    ("Nomi DB", "GeekClaw DB"),
    ("Nomi chat-path", "GeekClaw chat-path"),
    ("Nomi initial", "GeekClaw initial"),
    ("Nomi stop", "GeekClaw stop"),
    ("Nomi send_message", "GeekClaw send_message"),
    ("Nomi turn", "GeekClaw turn"),
    ("Nomi steering", "GeekClaw steering"),
    ("Nomi truncation", "GeekClaw truncation"),
    ("Nomi process-tree", "GeekClaw process-tree"),
    ("Nomi isolated", "GeekClaw isolated"),
    ("Nomi CLI", "GeekClaw CLI"),
    ("Nomi error", "GeekClaw error"),
    ("Nomi Browser", "GeekClaw Browser"),
    ("Nomi browser", "GeekClaw browser"),
    ("Nomi logical", "GeekClaw logical"),
    ("Nomi jobs", "GeekClaw jobs"),
    ("Nomi cron", "GeekClaw cron"),
    ("Nomi platform", "GeekClaw platform"),
    ("Nomi only", "GeekClaw only"),
    ("Nomi test", "GeekClaw test"),
    ("Nomi TextPattern", "GeekClaw TextPattern"),
    ("Nomi SetValue", "GeekClaw SetValue"),
    ("Nomi conversation", "GeekClaw conversation"),
    ("Nomi output", "GeekClaw output"),
    ("Nomi delivery", "GeekClaw delivery"),
    ("Nomi managed", "GeekClaw managed"),
    ("Nomi free", "GeekClaw free"),
    ("Nomi platform", "GeekClaw platform"),
    ("Nomi-managed", "GeekClaw-managed"),
    ("Nomi应用程序", "GeekClaw应用程序"),
    ("Nomi对话", "GeekClaw对话"),
    ("Nomi Router", "GeekClaw Router"),
    ("Nomi router", "GeekClaw router"),
    ("Nomi built-in", "GeekClaw built-in"),
    ("Nomi execution", "GeekClaw execution"),
    ("Nomi backend", "GeekClaw backend"),
    ("Nomi instance", "GeekClaw instance"),
    ("Nomi core", "GeekClaw core"),
    ("Nomi startup", "GeekClaw startup"),
    ("Nomi desktop", "GeekClaw desktop"),
    ("Nomi host", "GeekClaw host"),
    ("Nomi keeps", "GeekClaw keeps"),
    ("Nomi tool", "GeekClaw tool"),
    ("Nomi runtimes", "GeekClaw runtimes"),
    ("Nomi today", "GeekClaw today"),
    ("Nomi text", "GeekClaw text"),
    ("Nomi hook", "GeekClaw hook"),
    ("Nomi business", "GeekClaw business"),
    ("Nomi context", "GeekClaw context"),
    ("Nomi prompt", "GeekClaw prompt"),
    ("Nomi build", "GeekClaw build"),
    ("Nomi factory", "GeekClaw factory"),
    ("Nomi slot", "GeekClaw slot"),
    ("Nomi authority", "GeekClaw authority"),
    ("Nomi config", "GeekClaw config"),
    ("Nomi capability", "GeekClaw capability"),
    ("Nomi assets", "GeekClaw assets"),
    ("Nomi connector", "GeekClaw connector"),
    ("Nomi application", "GeekClaw application"),
    ("Nomi settings", "GeekClaw settings"),
    ("Nomi data", "GeekClaw data"),
    ("Nomi presence", "GeekClaw presence"),
    ("Nomi request", "GeekClaw request"),
    ("Nomi defaults", "GeekClaw defaults"),
    ("Nomi catalog", "GeekClaw catalog"),
    ("Nomi skills", "GeekClaw skills"),
    ("Nomi API", "GeekClaw API"),
    ("Nomi settings", "GeekClaw settings"),
    ("Nomi process", "GeekClaw process"),
    ("Nomi architecture", "GeekClaw architecture"),
    ("Nomi system", "GeekClaw system"),
    ("Nomi self-hosted", "GeekClaw self-hosted"),
    ("Nomi adapter", "GeekClaw adapter"),
    ("Nomi alias", "GeekClaw alias"),
    ("Nomi aliases", "GeekClaw aliases"),
    ("Nomi log", "GeekClaw log"),
    ("Nomi bin", "GeekClaw bin"),
    ("Nomi v3", "GeekClaw v3"),
    ("Nomi currently", "GeekClaw currently"),
    ("Nomi lifecycle", "GeekClaw lifecycle"),
    ("Nomi channel", "GeekClaw channel"),
    ("Nomi attributes", "GeekClaw attributes"),
    ("Nomi manifest", "GeekClaw manifest"),
    ("Nomi external", "GeekClaw external"),
    ("Nomi companion", "GeekClaw companion"),
    ("Nomi terminal", "GeekClaw terminal"),
    ("Nomi entity", "GeekClaw entity"),
    ("Nomi installation", "GeekClaw installation"),
    ("Nomi restart", "GeekClaw restart"),
    ("Nomi before", "GeekClaw before"),
    ("Nomi available", "GeekClaw available"),
    ("Nomi knows", "GeekClaw knows"),
    ("Nomi supports", "GeekClaw supports"),
    ("Nomi instruct", "GeekClaw instruct"),
    ("Nomi instruction", "GeekClaw instruction"),
    ("Nomi resolver", "GeekClaw resolver"),
    ("Nomi paths", "GeekClaw paths"),
    ("Nomi data root", "GeekClaw data root"),
    ("Nomi document", "GeekClaw document"),
    ("Nomi file", "GeekClaw file"),
    ("Nomi workspace", "GeekClaw workspace"),
    ("Nomi section", "GeekClaw section"),
    ("Nomi name", "GeekClaw name"),
    ("Nomi label", "GeekClaw label"),
    ("Nomi wordmark", "GeekClaw wordmark"),
]

# ──────────────────────────────────────────────────────────
# Regex replacements (for remaining standalone Nomi/nomi)
# ──────────────────────────────────────────────────────────
# \b matches word boundaries; NomiFun/Nomifun won't match because
# F/f are word characters (no word boundary between "Nomi" and "Fun"/"fun")
REGEX_PATTERNS = [
    # Standalone "Nomi" (uppercase) → "GeekClaw"
    # Won't match NomiFun, Nomifun, NomiAgentManager (already handled)
    (re.compile(r'\bNomi\b'), 'GeekClaw'),

    # Standalone lowercase "nomi" → "geekclaw"
    # Won't match nomifun, nomi_a11y (underscore is word char), nomicore (already handled)
    (re.compile(r'\bnomi\b'), 'geekclaw'),
]


def should_process(filepath):
    """Check if a file should be processed."""
    _, ext = os.path.splitext(filepath)
    return ext.lower() in EXTENSIONS


def should_skip_dir(dirname):
    """Check if a directory should be skipped."""
    return dirname in SKIP_DIRS


def process_file(filepath):
    """Process a single file, returning (was_modified, num_changes)."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            original = f.read()
    except (UnicodeDecodeError, PermissionError, OSError):
        return False, 0

    content = original
    changes = 0

    # Apply ordered exact replacements
    for old, new in ORDERED_REPLACEMENTS:
        if old in content:
            count = content.count(old)
            content = content.replace(old, new)
            changes += count

    # Apply regex replacements
    for pattern, replacement in REGEX_PATTERNS:
        new_content, count = pattern.subn(replacement, content)
        if count > 0:
            content = new_content
            changes += count

    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True, changes

    return False, 0


def main():
    total_files = 0
    modified_files = 0
    total_changes = 0

    for dirpath, dirnames, filenames in os.walk(ROOT):
        # Skip excluded directories
        dirnames[:] = [d for d in dirnames if not should_skip_dir(d)]

        for filename in filenames:
            filepath = os.path.join(dirpath, filename)
            if not should_process(filepath):
                continue

            total_files += 1
            modified, changes = process_file(filepath)
            if modified:
                modified_files += 1
                total_changes += changes
                rel_path = os.path.relpath(filepath, ROOT)
                print(f"  ✓ {rel_path} ({changes} changes)")

    print(f"\n{'='*60}")
    print(f"Scanned: {total_files} files")
    print(f"Modified: {modified_files} files")
    print(f"Total changes: {total_changes}")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
