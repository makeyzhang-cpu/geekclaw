#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""GeekClaw 自动更新签名体检器（零依赖，纯 Python Ed25519 + BLAKE2b）。

用途：在发布前验证 latest.json 的 signature 字段能被 tauri-plugin-updater 接受。
原理：完全复刻 tauri-plugin-updater 2.10.1 的 verify_signature 逻辑：
        base64_decode(signature_field) -> 必须是 4 行 minisign 文本
        Signature::decode(4 行)        -> key_id / algorithm / sig / global_sig
        PublicKey::decode(pubkey)      -> key_id 必须一致
        if prehashed: m = BLAKE2b-512(exe_bytes) else: m = exe_bytes
        Ed25519.verify(pk, sig, m)

用法：
  python verify_updater_sig.py --exe <exe> --sig <exe.sig> [--latest <latest.json>]
                               [--pubkey <base64>] [--expect-version 5.0.65]
退出码：0 = 全部通过；非 0 = 有 FAIL。
"""
import argparse
import base64
import hashlib
import json
import os
import sys

# ---------- 纯 Python Ed25519 验签（Bernstein 参考实现移植，仅验签） ----------
_P = 2 ** 255 - 19
_L = 2 ** 252 + 27742317777372353535851937790883648493


def _inv(x):
    return pow(x, _P - 2, _P)


_D = -121665 * _inv(121666) % _P
_I = pow(2, (_P - 1) // 4, _P)


def _xrecover(y):
    xx = (y * y - 1) * _inv(_D * y * y + 1) % _P
    x = pow(xx, (_P + 3) // 8, _P)
    if (x * x - xx) % _P != 0:
        x = x * _I % _P
    if x % 2 != 0:
        x = _P - x
    return x


_By = 4 * _inv(5) % _P
_Bx = _xrecover(_By)
_B = (_Bx % _P, _By % _P)


def _edwards(P, Q):
    x1, y1 = P
    x2, y2 = Q
    k = _D * x1 * x2 * y1 * y2 % _P
    x3 = (x1 * y2 + x2 * y1) * _inv(1 + k) % _P
    y3 = (y1 * y2 + x1 * x2) * _inv(1 - k) % _P
    return (x3, y3)


def _scalarmult(P, e):
    Q = (0, 1)
    while e > 0:
        if e & 1:
            Q = _edwards(Q, P)
        P = _edwards(P, P)
        e >>= 1
    return Q


def _isoncurve(P):
    x, y = P
    return (-x * x + y * y - 1 - _D * x * x * y * y) % _P == 0


def _decodepoint(s):
    y = int.from_bytes(s, "little") & ((1 << 255) - 1)
    x = _xrecover(y)
    if (x & 1) != ((s[31] >> 7) & 1):
        x = _P - x
    P = (x, y)
    if not _isoncurve(P):
        raise ValueError("point not on curve")
    return P


def ed25519_verify(sig, msg, pk):
    """sig: 64B (R||S), msg: bytes, pk: 32B。返回 True/False。"""
    if len(sig) != 64:
        raise ValueError("signature must be 64 bytes, got %d" % len(sig))
    if len(pk) != 32:
        raise ValueError("public key must be 32 bytes, got %d" % len(pk))
    R = _decodepoint(sig[:32])
    A = _decodepoint(pk)
    S = int.from_bytes(sig[32:], "little")
    if S >= _L:
        return False
    h = int.from_bytes(hashlib.sha512(sig[:32] + pk + msg).digest(), "little")
    return _scalarmult(_B, S) == _edwards(R, _scalarmult(A, h))


# ---------- minisign 结构解析（复刻 minisign-verify 0.2.5） ----------
def parse_minisign_box(text):
    lines = text.splitlines()
    if len(lines) < 4:
        raise ValueError("需要 4 行 minisign 文本，实际只有 %d 行" % len(lines))
    untrusted_comment = lines[0]
    bin1 = base64.b64decode(lines[1])
    trusted_comment = lines[2]
    bin2 = base64.b64decode(lines[3])
    if len(bin1) != 74:
        raise ValueError("签名行解码应为 74 字节，实际 %d" % len(bin1))
    if len(bin2) != 64:
        raise ValueError("trusted 签名行解码应为 64 字节，实际 %d" % len(bin2))
    if not trusted_comment.startswith("trusted comment: "):
        raise ValueError("第 3 行必须以 'trusted comment: ' 开头")
    alg = bin1[0:2]
    prehashed = {b"ED": True, b"Ed": False}.get(alg)
    if prehashed is None:
        raise ValueError("不支持的算法标识 %r" % alg)
    return {
        "untrusted_comment": untrusted_comment,
        "algorithm": alg.decode(),
        "prehashed": prehashed,
        "key_id": bin1[2:10],
        "sig": bin1[10:74],
        "trusted_comment": trusted_comment,
        "global_sig": bin2,
    }


def parse_public_key(pubkey_b64):
    text = base64.b64decode(pubkey_b64).decode("utf-8")
    lines = text.splitlines()
    bin1 = base64.b64decode(lines[1])
    if len(bin1) != 42:
        raise ValueError("公钥行解码应为 42 字节，实际 %d" % len(bin1))
    if bin1[0:2] != b"Ed":
        raise ValueError("公钥算法标识异常：%r" % bin1[0:2])
    return {"key_id": bin1[2:10], "key": bin1[10:42], "comment": lines[0]}


def read_pubkey_from_conf(conf_path):
    with open(conf_path, encoding="utf-8") as f:
        conf = json.load(f)
    return conf["plugins"]["updater"]["pubkey"]


class Report:
    def __init__(self):
        self.rows = []
        self.failed = 0

    def check(self, ok, label, detail=""):
        mark = "PASS" if ok else "FAIL"
        if not ok:
            self.failed += 1
        self.rows.append((mark, label, detail))
        return ok

    def dump(self):
        width = max((len(r[1]) for r in self.rows), default=10)
        for mark, label, detail in self.rows:
            line = "  [%s] %s" % (mark, label.ljust(width))
            if detail:
                line += "  " + detail
            print(line)
        return self.failed


def find_tauri_conf(start_dir):
    """从脚本所在目录向上最多 5 层，寻找 apps/desktop/tauri.conf.json。

    兼容脚本放在 <repo>/scripts/（仓库内，canonical）或 <repo 的兄弟目录>（如
    E:/GeekClaw源码/scripts/）两种布局。
    """
    d = os.path.abspath(start_dir)
    for _ in range(5):
        cand = os.path.join(d, "apps", "desktop", "tauri.conf.json")
        if os.path.isfile(cand):
            return cand
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    # 兜底：已知构建盘位置
    fallback = r"D:\gc-src\nomifun-tauri-0.4.1\apps\desktop\tauri.conf.json"
    return fallback if os.path.isfile(fallback) else os.path.join(
        os.path.dirname(os.path.abspath(start_dir)), "apps", "desktop", "tauri.conf.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exe", required=True)
    ap.add_argument("--sig", required=True)
    ap.add_argument("--latest", default=None)
    ap.add_argument("--pubkey", default=None)
    ap.add_argument("--conf", default=None)
    ap.add_argument("--expect-version", default=None)
    args = ap.parse_args()

    rep = Report()

    pubkey_b64 = args.pubkey
    if pubkey_b64 is None:
        conf = args.conf or find_tauri_conf(os.path.dirname(os.path.abspath(__file__)))
        rep.check(os.path.isfile(conf), "找到 tauri.conf.json", conf)
        pubkey_b64 = read_pubkey_from_conf(conf)

    # --- 1. 文件存在性 ---
    rep.check(os.path.isfile(args.exe), "安装包存在", args.exe)
    rep.check(os.path.isfile(args.sig), ".sig 文件存在", args.sig)

    exe_name = os.path.basename(args.exe)
    exe_size = os.path.getsize(args.exe)

    # --- 2. PE 头体检 ---
    with open(args.exe, "rb") as f:
        head = f.read(0x200)
    rep.check(head[:2] == b"MZ", "PE 头 MZ 魔数", head[:2].decode("latin1"))
    pe_off = int.from_bytes(head[0x3C:0x40], "little")
    rep.check(pe_off < exe_size, "PE 头偏移合法", "0x%X" % pe_off)
    rep.check(0 < exe_size < 600 * 1024 * 1024, "安装包体积合理",
              "%.1f MB" % (exe_size / 1024 / 1024))

    # --- 3. .sig 原始内容 = latest.json 应存的值 ---
    with open(args.sig, "rb") as f:
        sig_raw = f.read().strip()
    sig_text = base64.b64decode(sig_raw).decode("utf-8")
    rep.check(sig_text.startswith("untrusted comment: "),
              ".sig 原文 base64 解码为 minisign 文本", sig_text.splitlines()[0])
    rep.check(b"\n" not in sig_raw,
              ".sig 原文为单行（无换行污染）", "%d 字符" % len(sig_raw))

    box = parse_minisign_box(sig_text)
    pub = parse_public_key(pubkey_b64)
    rep.check(box["key_id"] == pub["key_id"], "签名 key_id == 公钥 key_id",
              box["key_id"].hex().upper())
    rep.check(box["prehashed"], "签名算法为预哈希模式", box["algorithm"])

    # --- 4. 真实 Ed25519 验签 ---
    print("  ... 正在计算 BLAKE2b-512 并验签（约 1-3s）")
    with open(args.exe, "rb") as f:
        digest = hashlib.blake2b(f.read(), digest_size=64).digest()
    msg = digest if box["prehashed"] else open(args.exe, "rb").read()
    try:
        ok = ed25519_verify(box["sig"], msg, pub["key"])
        rep.check(ok, "Ed25519 验签通过（安装包未被篡改）")
    except Exception as e:  # noqa: BLE001
        rep.check(False, "Ed25519 验签异常", str(e))

    # --- 5. latest.json 字段体检 ---
    if args.latest:
        rep.check(os.path.isfile(args.latest), "latest.json 存在", args.latest)
        try:
            with open(args.latest, encoding="utf-8") as f:
                lj = json.load(f)
        except Exception as e:  # noqa: BLE001
            rep.check(False, "latest.json 可解析", str(e))
            lj = None
        if lj is not None:
            plat = lj.get("platforms", {}).get("windows-x86_64", {})
            lj_sig = plat.get("signature", "")
            lj_url = plat.get("url", "")

            # 关键断言：字段必须是 .sig 原文，而不是解码后的签名行
            rep.check(lj_sig == sig_raw.decode("ascii"),
                      "signature 字段 == .sig 原文（关键）",
                      "长度 %d vs .sig %d" % (len(lj_sig), len(sig_raw)))
            rep.check(lj_sig.startswith("dW50cnVzdGVkIGNvbW1lbnQ6"),
                      "signature 以 base64 文本头开头（关键）", lj_sig[:28] + "...")
            try:
                inner = parse_minisign_box(base64.b64decode(lj_sig).decode("utf-8"))
                rep.check(inner["key_id"] == pub["key_id"],
                          "latest.json 内层 key_id 一致",
                          inner["key_id"].hex().upper())
                rep.check(inner["sig"] == box["sig"], "latest.json 内层签名 == .sig 内层签名")
            except Exception as e:  # noqa: BLE001
                rep.check(False, "latest.json 内层可解析为 4 行 minisign", str(e))

            rep.check(lj_url.endswith("/" + exe_name),
                      "下载 URL 指向本安装包", lj_url.rsplit("/", 1)[-1])
            rep.check(lj_url.startswith("https://github.com/makeyzhang-cpu/geekclaw/releases/download/"),
                      "下载 URL 为官方 Release 地址")
            if args.expect_version:
                rep.check(lj.get("version") == args.expect_version,
                          "version 字段 == %s" % args.expect_version, lj.get("version", ""))
                rep.check(exe_name == "GeekClaw_%s_x64-setup.exe" % args.expect_version,
                          "安装包文件名与版本一致", exe_name)
                rep.check("/v%s/" % args.expect_version in lj_url,
                          "URL 含 v%s tag" % args.expect_version)
            rep.check(bool(lj.get("notes")), "notes 非空")
            rep.check(bool(lj.get("pub_date")), "pub_date 非空", lj.get("pub_date", ""))

    print()
    print("=" * 68)
    failed = rep.dump()
    print("=" * 68)
    if failed:
        print("体检验签结果：%d 项 FAIL —— 禁止发布" % failed)
    else:
        print("体检验签结果：全部 PASS —— 该 latest.json 可被客户端自动更新接受")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
