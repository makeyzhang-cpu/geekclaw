import os, re

ROOT = r"L:\GeekClaw源码\v0.3.6\geekclaw-tauri-0.3.6"
SKIP_DIRS = {'target', 'node_modules', '.git', 'build.noindex', '.workbuddy', '__pycache__', '.cargo'}
SKIP_FILES = {'Cargo.lock', 'bun.lock'}
SKIP_EXTS = {'.py', '.pdb'}

# Crate suffixes to protect: geekclaw-<suffix> must NOT be replaced
PROTECT_SUFFIXES = [
    'api-types', 'ai-agent', 'model-invoke', 'webhook',
    'app', 'common', 'runtime', 'extension', 'conversation',
    'terminal', 'office', 'workshop', 'creation', 'knowledge',
    'cron', 'db', 'net',
]

# Build regex: match geekclaw NOT followed by -<protected_suffix> or _<letter>
suffix_alt = '|'.join(re.escape(s) for s in PROTECT_SUFFIXES)
PATTERN = re.compile(
    r'geekclaw(?!-(?:' + suffix_alt + r')|_[a-zA-Z])',
    re.IGNORECASE
)

def replacer(m):
    matched = m.group(0)
    if matched == 'GEEKCLAW': return 'GEEKCLAW'
    if matched == 'GeekClaw': return 'GeekClaw'
    if matched == 'Nomifun': return 'Geekclaw'
    return 'geekclaw'

total_changes = 0
files_changed = 0
changed_files = []

for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for fn in filenames:
        if fn in SKIP_FILES: continue
        if os.path.splitext(fn)[1] in SKIP_EXTS: continue
        fp = os.path.join(dirpath, fn)
        try:
            with open(fp, 'r', encoding='utf-8') as f:
                content = f.read()
        except (UnicodeDecodeError, PermissionError):
            continue
        new_content = PATTERN.sub(replacer, content)
        if new_content != content:
            old_count = content.lower().count('geekclaw')
            new_count = new_content.lower().count('geekclaw')
            diff = old_count - new_count
            total_changes += diff
            files_changed += 1
            rel = os.path.relpath(fp, ROOT)
            changed_files.append((rel, diff))
            with open(fp, 'w', encoding='utf-8') as f:
                f.write(new_content)

print(f"Done: {total_changes} replacements in {files_changed} files\n")
for rel, diff in sorted(changed_files, key=lambda x: -x[1]):
    print(f"  {diff:4d}  {rel}")
