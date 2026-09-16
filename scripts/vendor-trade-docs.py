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

# 上游自带的缺陷修复（与品牌无关，但不修就是坏页面）。
# ⚠️ 已核对上游 `D:/gc-src/_oss/tradekit`：`labelInput2` / `labelInputDate2`
#    在 cost-estimation.html 与 common.js 里**都没有定义**，而同文件里定义了
#    同签名的 `labelInput(l,v,f,p)` / `labelInputDate(l,v,f)` 并大量正常调用。
#    因此这是上游的命名笔误：cost-estimation 页 renderForm() 一跑就 ReferenceError。
#    替换顺序必须「先长后短」，且**不能**碰到 `labelSelect2`（它是真名，有定义）。
UPSTREAM_FIXES: list[tuple[str, str]] = [
    ('labelInputDate2(', 'labelInputDate('),
    ('labelInput2(', 'labelInput('),
]

NOTICE = """\
NOTICE — 外贸单证工具箱（第三方开源组件归属声明）

本目录中的外贸单证页面（19 种国际贸易单证 + 4 项实用工具）基于以下开源项目二次开发：

    原项目：TradeKit
    仓库  ：https://github.com/trdeep/tradekit
    许可  ：MIT License

二次开发内容：品牌替换（TradeKit → GeekDoc）、移除第三方访问统计脚本、
移除原站点 SEO 标签与站内推广位、适配 GeekClaw 内嵌运行环境、
修复上游 `cost-estimation.html` 中 `labelInput2` / `labelInputDate2` 未定义的笔误
（详见 `scripts/vendor-trade-docs.py` 的 UPSTREAM_FIXES）。
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
# 🔴 上面只摘「定义」，但**调用点**留在每一个 HTML 的内联脚本里。
# 这些调用位于**顶层**（夹在函数声明之间），而函数已被删除 →
# 页面加载即 `ReferenceError: injectSpaButton is not defined`，
# 内联脚本从此中断，脚本末尾的 `init()` **永远不会执行** →
# `renderForm()` 不跑 → 右侧表单区整片空白（只有静态 HTML 的标题/EN/Light 可见）。
# 2026-09-16 用户报障「单证工具右边全是空白」，19 个页面全部中招。
# 因此摘除定义的同时必须一并摘除调用点。
RE_PROMO_CALL = re.compile(
    r'^[ \t]*inject(?:SpaButton|BottomCta)\(\);[ \t]*\r?\n',
    re.MULTILINE,
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
    # 🔴 必须摘掉推广函数的**调用点**：定义在 common.js 里被 RE_PROMO_FN 摘了，
    # 调用点若留着就是顶层 ReferenceError，整页脚本挂掉（见 RE_PROMO_CALL 注释）。
    text = RE_PROMO_CALL.sub('', text)
    # 正文里可能残留指向原站的绝对链接 → 转成站内相对链接
    text = re.sub(r'https?://(?:tradekit|trade)\.treedeep\.cn/', '', text)
    text = text.replace(BRAND_FROM, BRAND_TO)
    for a, b in PROSE_FIXES:
        text = text.replace(a, b)
    for a, b in UPSTREAM_FIXES:
        text = text.replace(a, b)
    return text


def transform_js(text: str) -> str:
    text = RE_PROMO_FN.sub('\n', text)
    text = text.replace(BRAND_FROM, BRAND_TO)
    for a, b in PROSE_FIXES:
        text = text.replace(a, b)
    for a, b in UPSTREAM_FIXES:
        text = text.replace(a, b)
    return text


def read_inline_scripts(html: str) -> str:
    return '\n'.join(
        re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.DOTALL)
    )


def defined_names(js: str) -> set[str]:
    out = set(re.findall(r'function\s+([A-Za-z_$][\w$]*)', js))
    out |= set(re.findall(r'(?:var|let|const)\s+([A-Za-z_$][\w$]*)', js))
    out |= set(re.findall(r'([A-Za-z_$][\w$]*)\s*=\s*function', js))
    return out


# 正则会把字符串/表达式里的词当函数名抓出来（CSS 的 `repeat(`、模板里的表头等），
# 这些是确定噪声，白名单放行即可。
CALL_SCAN_NOISE = {
    'minmax', 'repeat', 'fit', 'content', 'auto', 'fr', 'calc', 'url', 'var',
    'function', 'if', 'else', 'for', 'while', 'switch', 'catch', 'return',
    'typeof', 'in', 'of', 'new', 'delete', 'void', 'do', 'try', 'finally',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
    'decodeURIComponent', 'setTimeout', 'setInterval', 'clearTimeout',
    'clearInterval', 'alert', 'confirm', 'prompt', 'fetch', 'structuredClone',
    'requestAnimationFrame', 'esc2',
}


def find_dead_calls(out_dir: str) -> list[str]:
    """找出「调用了但没定义」的顶层函数 —— 这类问题会让整页脚本静默中断。

    2026-09-16：`injectSpaButton()` / `injectBottomCta()` 的定义被 RE_PROMO_FN
    摘掉、调用点却留着，且位于顶层 → 页面加载即 ReferenceError →
    末尾的 `init()` 不执行 → 单证表单区整片空白，19 个页面全中招。
    这条自检就是为了让同类问题在生成阶段就暴露，而不是等用户截图反馈。
    """
    common_path = os.path.join(out_dir, 'common.js')
    common_defs = defined_names(open(common_path, encoding='utf-8').read()) if os.path.isfile(common_path) else set()

    findings: list[str] = []
    for name in sorted(os.listdir(out_dir)):
        if not name.endswith('.html'):
            continue
        inline = read_inline_scripts(
            open(os.path.join(out_dir, name), encoding='utf-8', errors='replace').read()
        )
        known = defined_names(inline) | common_defs | CALL_SCAN_NOISE
        calls = set(re.findall(r'(?<![\w.$])([A-Za-z_$][\w$]*)\s*\(', inline))
        dead = sorted(c for c in calls if c not in known and (c[:1].islower() or c[-1:].isdigit()))
        if dead:
            findings.append(f'{name}: {dead}')
    return findings


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

    dead = find_dead_calls(out)
    if dead:
        print('  [FAIL] 存在「调用了但没定义」的函数 —— 会导致整页脚本中断:', file=sys.stderr)
        for row in dead:
            print(f'         {row}', file=sys.stderr)
        return 1

    print('  自检通过：无原站点域名、无第三方统计、无旧品牌名、无未定义函数调用')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
