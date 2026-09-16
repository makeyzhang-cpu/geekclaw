#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""vendor-trade-docs.py — 把 TradeKit（MIT）内置为「外贸单证工具箱」。

TradeKit 是一套纯静态的外贸单证页面（19 种单证 + 4 项工具），直接内嵌到
GeekClaw 的「B2B外贸跟单工作台」里使用。本脚本做三件事：

1. 拷贝所需静态资源（*.html / common.css / common.js / html2pdf.bundle.min.js）
   到 ui/public/trade-docs/，让它们随前端一起打包、离线可用。
2. 去外包化：
   - 移除第三方访问统计脚本（goatcounter / zgo.at）
   - 移除指向原站点的 SEO 标签（canonical / hreflang / og:url / JSON-LD）与站内推广位
   - 品牌名 TradeKit → GeekDoc（自有品牌）
3. 写入 NOTICE.txt 保留 MIT 归属声明（合规必需，不在任何界面上展示）。

用法：
    python scripts/vendor-trade-docs.py --source "D:/gc-src/_oss/tradekit" --out "ui/public/trade-docs"
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import sys

# 只保留运行必需的资源；robots/sitemap/llms 是给搜索引擎与 LLM 爬虫看的，
# 内嵌到桌面端毫无意义，且含原站点地址，直接丢弃。
KEEP_EXT = {'.html', '.css', '.js'}

BRAND_FROM = 'TradeKit'
BRAND_TO = 'GeekDoc'

# 品牌替换后需要再修正的「读起来别扭」的句子（顺序敏感，先长后短）
PROSE_FIXES: list[tuple[str, str]] = [
    ('GeekDoc 外贸单证工具箱', 'GeekDoc 单证工具箱'),
    ('GeekDoc外贸单证工具箱', 'GeekDoc 单证工具箱'),
    ('GeekDoc - 免费外贸单证工具箱', 'GeekDoc 单证工具箱 - 免费外贸单证在线生成'),
    ('GeekDoc是免费开源的外贸单证生成工具', 'GeekDoc 单证工具箱是免费、开源的在线外贸单证生成工具'),
    ('GeekDoc is a free, open-source trade document generator',
     'GeekDoc is a free, open-source trade document toolkit'),
    ('GeekDoc — Trade Document Generator', 'GeekDoc Trade Documents'),
    ('GeekDoc外贸单证工具箱', 'GeekDoc 单证工具箱'),
]

NOTICE = """\
NOTICE — 外贸单证工具箱（第三方开源组件归属声明）

本目录中的外贸单证页面（19 种国际贸易单证 + 4 项实用工具）基于以下开源项目二次开发：

    原项目：TradeKit
    仓库  ：https://github.com/trdeep/tradekit
    许可  ：MIT License

二次开发内容：品牌替换（TradeKit → GeekDoc）、移除第三方访问统计脚本、
移除原站点 SEO 标签与站内推广位、适配 GeekClaw 内嵌运行环境。
除上述改动外，页面结构与业务逻辑保持原样。

------------------------------------------------------------------------------
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""

# --------------------------------------------------------------------------- #
# 需要摘除的片段
# --------------------------------------------------------------------------- #

# 第三方访问统计（goatcounter）
RE_ANALYTICS = re.compile(
    r'[ \t]*<script[^>]*data-goatcounter="[^"]*"[^>]*>\s*</script>\s*\n?',
    re.IGNORECASE,
)
# 结构化数据块（SEO 用，内含原站点 URL）
RE_JSONLD = re.compile(
    r'[ \t]*<script\s+type="application/ld\+json"[^>]*>.*?</script>\s*\n?',
    re.IGNORECASE | re.DOTALL,
)
# canonical / hreflang / og:url 等含原站点地址的标签
RE_ORIGIN_TAG = re.compile(
    r'[ \t]*<(?:link|meta)\b[^>]*(?:treedeep\.cn)[^>]*>\s*\n?',
    re.IGNORECASE,
)
# 站内推广位（把用户往原站引的两个注入函数，均为死代码）
RE_PROMO_FN = re.compile(
    r'\nfunction\s+(?:injectSpaButton|injectBottomCta)\s*\(\s*\)\s*\{.*?\n\}\n',
    re.DOTALL,
)
# 摘除 script 后遗留的注释壳（如 `<!-- GoatCounter -->`）。
# 上面的 RE_ANALYTICS 只吃 <script> 本体，原站会在前面留一行说明性注释，
# 注释里带着统计服务商品牌名，必须一并清掉。
RE_TRACK_COMMENT = re.compile(
    r'[ \t]*<!--[^>]*?(?:goat\s*counter|zgo\.at|treedeep)[^>]*?-->[ \t]*\r?\n?',
    re.IGNORECASE,
)


def transform_html(text: str) -> str:
    text = RE_ANALYTICS.sub('', text)
    text = RE_TRACK_COMMENT.sub('', text)
    text = RE_JSONLD.sub('', text)
    text = RE_ORIGIN_TAG.sub('', text)
    # 正文里可能残留指向原站的绝对链接 → 转成站内相对链接
    text = re.sub(r'https?://(?:tradekit|trade)\.treedeep\.cn/', '', text)
    text = text.replace(BRAND_FROM, BRAND_TO)
    for a, b in PROSE_FIXES:
        text = text.replace(a, b)
    return text


def transform_js(text: str) -> str:
    text = RE_PROMO_FN.sub('\n', text)
    text = text.replace(BRAND_FROM, BRAND_TO)
    for a, b in PROSE_FIXES:
        text = text.replace(a, b)
    return text


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', required=True, help='TradeKit 检出目录')
    ap.add_argument('--out', required=True, help='输出目录，如 ui/public/trade-docs')
    ap.add_argument('--brand', default=BRAND_TO, help='替换后的品牌名')
    args = ap.parse_args()

    src = os.path.abspath(args.source)
    out = os.path.abspath(args.out)
    if not os.path.isdir(src):
        print(f'[ERROR] 源目录不存在: {src}', file=sys.stderr)
        return 2

    os.makedirs(out, exist_ok=True)

    copied, skipped = [], []
    for name in sorted(os.listdir(src)):
        path = os.path.join(src, name)
        if not os.path.isfile(path):
            continue
        ext = os.path.splitext(name)[1].lower()
        if ext not in KEEP_EXT:
            skipped.append(name)
            continue

        with open(path, encoding='utf-8', errors='replace') as f:
            text = f.read()
        if ext == '.html':
            text = transform_html(text)
        elif ext == '.js':
            text = transform_js(text)
        else:
            text = text.replace(BRAND_FROM, BRAND_TO)

        with open(os.path.join(out, name), 'w', encoding='utf-8', newline='') as f:
            f.write(text)
        copied.append(name)

    with open(os.path.join(out, 'NOTICE.txt'), 'w', encoding='utf-8', newline='') as f:
        f.write(NOTICE)

    # —— 合规自检：输出目录里不允许再出现原站点域名或第三方统计 ——
    leaks: list[str] = []
    brand_left: list[str] = []
    for name in sorted(os.listdir(out)):
        path = os.path.join(out, name)
        if not os.path.isfile(path):
            continue
        if name == 'NOTICE.txt':
            continue  # 归属声明里必须写明原项目地址，跳过
        with open(path, encoding='utf-8', errors='replace') as f:
            body = f.read()
        # ⚠️ 一律降成小写再比对：原站注释写的是 `GoatCounter`（首字母大写），
        #    早先这里用大小写敏感的 'goatcounter' 直接漏检，导致注释壳被带进产物。
        probe = body.lower()
        if 'treedeep' in probe:
            leaks.append(name)
        if 'goatcounter' in probe or 'zgo.at' in probe:
            leaks.append(name + ' (analytics)')
        if BRAND_FROM.lower() in probe:
            brand_left.append(name)

    print(f'内置 {len(copied)} 个文件 → {out}')
    print(f'  跳过（非运行必需）: {", ".join(skipped) or "无"}')
    if leaks:
        print(f'  [FAIL] 仍含原站点/统计痕迹: {sorted(set(leaks))}', file=sys.stderr)
        return 1
    if brand_left:
        print(f'  [FAIL] 仍含旧品牌名: {sorted(set(brand_left))}', file=sys.stderr)
        return 1
    print('  自检通过：无原站点域名、无第三方统计、无旧品牌名')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
