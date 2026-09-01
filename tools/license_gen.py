#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GeekClaw 离线 license 生成器（开发/演示用）。

与后端 `crates/backend/nomifun-app/src/router/license_routes.rs` 的签名逻辑
逐字节一致：

    message = f"geekclaw-license|1|{edition}|{iat}|{exp}|{feats}"
    sig     = sha256(SECRET + message.encode("utf-8")).hexdigest()
    key     = "GEEK*" + message.encode("utf-8").hex() + "*" + sig

其中 feats 为按字典序排序、以 `;` 连接的特性列表，每个特性仅含 [a-z0-9-]。
exp == 0 表示永久有效；否则为到期 Unix 秒。

这是对等端离线软 DRM（客户端可破解），仅用于本地/离线商业闭环演示；
生产环境应改为后端签发 + 支付校验，前端契约不变。

用法：
    python tools/license_gen.py --edition pro --days 365 --features team-consensus advanced-reasoning
    python tools/license_gen.py --edition pro --perpetual
"""

import argparse
import hashlib
import sys
import time

# 必须与后端 LICENSE_SECRET 完全一致。
LICENSE_SECRET = b"geekclaw-offline-license-secret-v1"
KEY_PREFIX = "GEEK"
SEP = "*"


def build_message(edition: str, iat: int, exp: int, features: list[str]) -> str:
    feats = sorted(features)
    return f"geekclaw-license|1|{edition}|{iat}|{exp}|{';'.join(feats)}"


def sign_message(message: str) -> str:
    return hashlib.sha256(LICENSE_SECRET + message.encode("utf-8")).hexdigest()


def make_key(edition: str, days: int, features: list[str], perpetual: bool = False) -> str:
    iat = int(time.time())
    exp = 0 if perpetual else iat + days * 86400
    message = build_message(edition, iat, exp, features)
    sig = sign_message(message)
    return f"{KEY_PREFIX}{SEP}{message.encode('utf-8').hex()}{SEP}{sig}"


def main() -> int:
    parser = argparse.ArgumentParser(description="GeekClaw 离线 license 生成器")
    parser.add_argument("--edition", default="pro", help="版本 (默认: pro)")
    parser.add_argument("--days", type=int, default=365, help="有效期天数 (默认: 365)")
    parser.add_argument("--perpetual", action="store_true", help="永久有效 (忽略 --days)")
    parser.add_argument(
        "--features",
        nargs="*",
        default=[],
        help="特性列表，如 team-consensus advanced-reasoning",
    )
    args = parser.parse_args()

    for f in args.features:
        if not all(c.isalnum() or c == "-" for c in f) or "|" in f or ";" in f:
            print(f"错误：特性名非法 -> {f!r}（仅允许 [a-z0-9-]，且不含 | ;）", file=sys.stderr)
            return 2

    key = make_key(args.edition, args.days, args.features, args.perpetual)
    exp_label = "永久" if args.perpetual else f"{args.days} 天"
    print(f"# GeekClaw 离线 License（edition={args.edition}, 有效期={exp_label}, features={args.features or '无'}）")
    print(key)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
