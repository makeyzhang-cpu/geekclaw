#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate latest.json for the Tauri updater from a built NSIS installer + its .sig.

CANONICAL COPY: E:/GeekClaw源码/scripts/gen_latest.py

Usage:
    python gen_latest.py <version> <notes_file> <exe_path> <sig_path> [out_path]
                         [--no-verify] [--expect-version X.Y.Z]

=======================================================================
🔴 核心格式规则（勿改）
=======================================================================
tauri-plugin-updater 2.10.1 / 2.11.0 —— src/updater.rs::verify_signature()

    let signature_base64_decoded = base64_to_string(release_signature)?;  // 先 base64 解码
    let signature = Signature::decode(&signature_base64_decoded)?;        // 再解 4 行 minisign
    public_key.verify(data, &signature, true)?;

而 minisign-verify 0.2.5 的 Signature::decode() 要求输入【恰好 4 行】：
    1) untrusted comment: signature from tauri secret key
    2) base64(74B)  = alg(2) + key_id(8) + ed25519_sig(64)
    3) trusted comment: timestamp:...\tfile:...
    4) base64(64B)  = global signature

⇒ latest.json 的 signature 字段必须 == 【.sig 文件的原始内容】(420 字符单行 base64)。
❌ 绝不能填「解码后的签名行」（100 字符、以 RUS0... 开头）——那样 decode 只拿到 1 行，
   直接 InvalidEncoding，客户端自动更新 100% 失败。
⚠️ 历史事故：v5.0.64 的 latest.json 就填错成 100 字符签名行（exe/.sig 本身有效），
   只因当时是 Pre-release、latest 通道仍指向 v5.0.63 才未暴雷。本脚本现在会主动拦截。
"""
import base64
import datetime
import json
import os
import subprocess
import sys

VERIFY_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "verify_updater_sig.py")


def load_signature(sig_path):
    """读取 .sig 并严格校验它就是 4 行 minisign 文本的 base64 原文。"""
    with open(sig_path, "rb") as f:
        raw = f.read().strip()
    try:
        text = raw.decode("ascii")
    except UnicodeDecodeError as e:
        raise SystemExit(f"[FATAL] {sig_path} 不是 ASCII 单行 base64：{e}")
    if "\n" in text or "\r" in text:
        raise SystemExit("[FATAL] .sig 内含换行，疑似已被二次处理")
    try:
        box = base64.b64decode(text, validate=True).decode("utf-8")
    except Exception as e:  # noqa: BLE001
        raise SystemExit(
            f"[FATAL] .sig 不是合法 base64（{e}）。\n"
            "        常见错误：填成了解码后的签名行（100 字符、RUS0... 开头）。"
        )
    lines = box.splitlines()
    if len(lines) != 4:
        raise SystemExit(
            f"[FATAL] .sig 解码后应为 4 行 minisign 文本，实际 {len(lines)} 行。"
        )
    if not lines[0].startswith("untrusted comment: "):
        raise SystemExit("[FATAL] .sig 第 1 行缺少 'untrusted comment: '")
    if not lines[2].startswith("trusted comment: "):
        raise SystemExit("[FATAL] .sig 第 3 行缺少 'trusted comment: '")
    if len(base64.b64decode(lines[1])) != 74:
        raise SystemExit("[FATAL] .sig 第 2 行解码后应为 74 字节")
    if len(base64.b64decode(lines[3])) != 64:
        raise SystemExit("[FATAL] .sig 第 4 行解码后应为 64 字节")
    return text, lines


def main():
    argv = [a for a in sys.argv[1:]]
    do_verify = "--no-verify" not in argv
    argv = [a for a in argv if a != "--no-verify"]
    expect_version = None
    if "--expect-version" in argv:
        i = argv.index("--expect-version")
        expect_version = argv[i + 1]
        del argv[i:i + 2]
    pub_date = None
    if "--pub-date" in argv:
        i = argv.index("--pub-date")
        pub_date = argv[i + 1]
        del argv[i:i + 2]

    if len(argv) < 4:
        raise SystemExit(__doc__.strip().splitlines()[4].strip())

    version, notes_file, exe_path, sig_path = argv[0], argv[1], argv[2], argv[3]
    out_path = argv[4] if len(argv) > 4 else f"latest_{version}.json"

    with open(notes_file, encoding="utf-8") as f:
        notes = f.read().strip()
    if not notes:
        raise SystemExit(f"[FATAL] release notes 为空：{notes_file}")

    signature, lines = load_signature(sig_path)
    exe_name = os.path.basename(exe_path)
    if not exe_name.startswith(f"GeekClaw_{version}_"):
        raise SystemExit(
            f"[FATAL] 安装包文件名 {exe_name} 与版本 {version} 不匹配"
        )
    if not os.path.isfile(exe_path):
        raise SystemExit(f"[FATAL] 安装包不存在：{exe_path}")

    url = (f"https://github.com/makeyzhang-cpu/geekclaw/releases/download/"
           f"v{version}/{exe_name}")

    data = {
        "version": version,
        "notes": notes,
        "pub_date": pub_date or datetime.datetime.now(datetime.timezone.utc)
                            .strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": {
            "windows-x86_64": {
                "signature": signature,
                "url": url,
            }
        },
    }
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"[ok] wrote {out_path} ({os.path.getsize(out_path)} bytes)")
    print(f"     signature 长度 {len(signature)}（正确值应为 420）")
    print(f"     url {url}")

    if do_verify:
        if not os.path.isfile(VERIFY_SCRIPT):
            print(f"[warn] 未找到验签器 {VERIFY_SCRIPT}，跳过体检", file=sys.stderr)
            return 0
        cmd = [sys.executable, VERIFY_SCRIPT, "--exe", exe_path, "--sig", sig_path,
               "--latest", out_path]
        if expect_version or version:
            cmd += ["--expect-version", expect_version or version]
        print("\n[verify] " + " ".join(cmd))
        rc = subprocess.call(cmd)
        if rc != 0:
            raise SystemExit(f"[FATAL] 验签体检未通过（rc={rc}），禁止发布")
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
