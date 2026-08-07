import os, re

ROOT = os.path.dirname(os.path.abspath(__file__))

# These crate suffixes were accidentally renamed geekclaw-<suffix> and must be reverted to geekclaw-<suffix>
# (directory names are still geekclaw-<suffix>, and code uses nomifun_<suffix>:: module paths)
REVERT_SUFFIXES = [
    'agent-execution', 'browser-platform', 'customer-service',
    'assets', 'auth', 'channel', 'companion', 'file', 'gateway',
    'idmm', 'mcp', 'preset', 'public', 'realtime', 'requirement',
    'secret', 'shell', 'system',
]

# Build replacement map: geekclaw-<suffix> -> geekclaw-<suffix>
# Also geekclaw_<suffix> -> nomifun_<suffix> (for workspace dependency references using underscores)
replacements = {}
for suffix in REVERT_SUFFIXES:
    replacements[f'geekclaw-{suffix}'] = f'geekclaw-{suffix}'
    # Also handle underscore form in case any exist (e.g., in build scripts)
    # But DON'T touch module paths like geekclaw_gateway:: — those shouldn't exist
    # because the script protected _[a-zA-Z] patterns

# Only process Cargo.toml files
total_changes = 0
files_changed = 0

for dirpath, dirnames, filenames in os.walk(ROOT):
    # Skip irrelevant dirs
    dirnames[:] = [d for d in dirnames if d not in {'target', 'node_modules', '.git', 'build.noindex', '.workbuddy', '.cargo', '__pycache__'}]
    for fn in filenames:
        if fn != 'Cargo.toml':
            continue
        fp = os.path.join(dirpath, fn)
        try:
            with open(fp, 'r', encoding='utf-8') as f:
                content = f.read()
        except (UnicodeDecodeError, PermissionError):
            continue
        
        new_content = content
        for old, new in replacements.items():
            new_content = new_content.replace(old, new)
        
        if new_content != content:
            changes = sum(1 for old in replacements if content.count(old) > 0 for _ in range(content.count(old)))
            actual_diff = sum(content.count(old) - new_content.count(old) for old in replacements)
            total_changes += actual_diff
            files_changed += 1
            rel = os.path.relpath(fp, ROOT)
            print(f"  {actual_diff:3d}  {rel}")
            with open(fp, 'w', encoding='utf-8') as f:
                f.write(new_content)

print(f"\nDone: reverted {total_changes} crate name references in {files_changed} Cargo.toml files")
