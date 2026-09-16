# -*- coding: utf-8 -*-
"""把《GeekClawAI办公盒子各版本服务表》的内容写进 pricing 语言包（zh-CN + en-US 同步）。"""
import json, sys, os

sys.stdout.reconfigure(encoding='utf-8')
ROOT = r'E:\GeekClaw源码\v0.4.1-upgrade\nomifun-tauri-0.4.1'
LOC = os.path.join(ROOT, 'ui', 'src', 'renderer', 'services', 'i18n', 'locales')

# (相对 pricing 的键路径, 中文, 英文)
TABLE = [
    # ---- 5 档套餐 ----
    ('plan.basic.name', 'GeekClaw AI数字员工基础版', 'GeekClaw AI Employee Basic'),
    ('plan.basic.short', 'AI数字员工基础版', 'AI Employee Basic'),
    ('plan.basic.tagline', '通用 AI 工作站起步档，先把数字员工跑起来', 'The entry tier that gets your AI workforce running'),
    ('plan.geo.name', 'GeekClaw 国内GEO版', 'GeekClaw Domestic GEO'),
    ('plan.geo.short', '国内GEO版', 'Domestic GEO'),
    ('plan.geo.tagline', '面向国内市场的 AI GEO 内容与媒体矩阵', 'AI GEO content and media matrix for the China market'),
    ('plan.trade-biz.name', 'GeekClaw 外贸业务版', 'GeekClaw Trade Sales'),
    ('plan.trade-biz.short', '外贸业务版', 'Trade Sales'),
    ('plan.trade-biz.tagline', '外贸获客与成交：业务团队 + 专属技能 + GeekLink 专家系统', 'Trade lead-gen and closing: sales team, skills and the GeekLink expert system'),
    ('plan.trade-ops.name', 'GeekClaw 外贸运营版', 'GeekClaw Trade Operations'),
    ('plan.trade-ops.short', '外贸运营版', 'Trade Operations'),
    ('plan.trade-ops.tagline', '外贸运营与增长：运营团队 + 专属技能 + OrbitAI 国际GEO 系统', 'Trade ops and growth: ops team, skills and the OrbitAI international GEO system'),
    ('plan.trade-flagship.name', 'GeekClaw 外贸旗舰版', 'GeekClaw Trade Flagship'),
    ('plan.trade-flagship.short', '外贸旗舰版', 'Trade Flagship'),
    ('plan.trade-flagship.tagline', '业务 + 运营双系统全开，唯一覆盖全部能力的档位', 'Both sales and ops systems unlocked — the only tier covering every capability'),
    ('badge.allIncluded', '全功能', 'All features'),

    # ---- 年付 ----
    ('yearlyPerMonthEq', '折合 ¥{{price}} / 月', '≈ ¥{{price}} / mo'),
    ('yearlySave', '年付省 ¥{{amount}}', 'Save ¥{{amount}} a year'),
    ('cta.subscribe', '订阅', 'Subscribe'),

    # ---- 硬件区 ----
    ('hardware.title', '端侧算力盒子', 'Edge AI Box'),
    ('hardware.subtitle', '所有档位共用同一台端侧算力盒子——算力在本机，数据不出门。', 'Every tier runs on the same edge AI box — compute stays local, your data never leaves the machine.'),
    ('hardware.marketNote', '高配机型，市场价 2 万余元/台（同配置英伟达整机 8 万余元/台）',
     'High-spec unit; market price over ¥20,000 (a comparable NVIDIA build runs over ¥80,000)'),
    ('hardware.deposit.title', '押金 {{amount}} 元/台', 'Deposit ¥{{amount}} per box'),
    ('hardware.deposit.line1', '合作满 3 年，算力盒子归用户所有', 'After 3 years of partnership the box becomes yours'),
    ('hardware.deposit.line2', '押金可抵扣服务费或退回', 'The deposit can be offset against service fees or refunded'),
    ('hardware.spec.cpu.label', 'CPU', 'CPU'),
    ('hardware.spec.cpu.value', 'Core i5-13420H 8C/12T, 4.6GHz', 'Core i5-13420H 8C/12T, 4.6GHz'),
    ('hardware.spec.gpu.label', 'GPU', 'GPU'),
    ('hardware.spec.gpu.value', 'Arc Pro B50 16 Xe-cores', 'Arc Pro B50, 16 Xe-cores'),
    ('hardware.spec.vram.label', '显存', 'VRAM'),
    ('hardware.spec.vram.value', '16GB GDDR6', '16GB GDDR6'),
    ('hardware.spec.tops.label', 'AI 算力（INT8）', 'AI compute (INT8)'),
    ('hardware.spec.tops.value', '170 TOPS', '170 TOPS'),
    ('hardware.spec.ram.label', '内存', 'Memory'),
    ('hardware.spec.ram.value', '32GB LPDDR4X', '32GB LPDDR4X'),
    ('hardware.spec.storage.label', '存储', 'Storage'),
    ('hardware.spec.storage.value', '1TB', '1TB'),

    # ---- 对比矩阵 ----
    ('matrix.title', '功能对比', 'Compare plans'),
    ('matrix.note', '√ 表示开通该功能或服务，— 表示无该服务；「开发中」表示功能正在开发。',
     '√ means the feature or service is included; — means it is not; “In development” means it is being built.'),
    ('matrix.col.group', '功能', 'Capability'),
    ('matrix.col.feature', '功能介绍', 'Feature'),
    ('matrix.col.detail', '功能详情', 'Details'),
    ('matrix.state.dev', '开发中', 'In development'),
    ('matrix.state.no', '—', '—'),
    ('matrix.group.ai-general', 'AI通用智能体', 'AI General Agents'),
    ('matrix.group.ai-trade', 'AI出海智能体', 'AI Trade Agents'),
    ('matrix.group.ai-crossborder', 'AI跨境电商智能体', 'AI Cross-border Agents'),
    ('matrix.group.ai-marketing', 'AI营销智能体', 'AI Marketing Agents'),
    ('matrix.feature.basicSetup', '基础设置', 'Core setup'),
    ('matrix.feature.b2bOps', 'B2B外贸运营工作台', 'B2B Trade Operations Workbench'),
    ('matrix.feature.b2bSales', 'B2B外贸业务工作台', 'B2B Trade Sales Workbench'),
    ('matrix.feature.a2a', 'A2A跨境电商', 'A2A Cross-border Commerce'),
    ('matrix.feature.opc', 'OPC分销工作台', 'OPC Distribution Workbench'),
    ('matrix.feature.aiArt', 'AI创艺工作台', 'AI Creative Workbench'),
    ('matrix.feature.domesticGeo', '国内GEO', 'Domestic GEO'),

    # ---- 行详情 ----
    ('matrix.general.d1', 'AI主会话+协作者模型', 'AI main session with collaborator models'),
    ('matrix.general.d2', '数字员工和专家分身库（克隆销冠、打造专属数字分身员工团队）',
     'Digital-employee and expert-avatar library (clone your top sellers, build a dedicated avatar team)'),
    ('matrix.general.d3', '集成skill技能库', 'Integrated skill library'),
    ('matrix.general.d4', '集成MCP', 'Integrated MCP'),
    ('matrix.general.d5', '集成插件库', 'Integrated plugin library'),
    ('matrix.general.d6', '浏览器', 'Browser'),
    ('matrix.general.d7', '远程主机', 'Remote host'),
    ('matrix.general.d8', 'AI客服', 'AI customer service'),
    ('matrix.general.d9', '全球多Agent引擎可选', 'Selectable global multi-agent engines'),

    ('matrix.opsTeam.d1', '外贸运营数字员工团队', 'Trade operations digital-employee team'),
    ('matrix.opsSkill.d1', '外贸运营专属skill技能', 'Trade-ops dedicated skills'),

    ('matrix.opsOrbit.d1', 'OrbitAI国际GEO AI营销系统', 'OrbitAI international GEO marketing system'),
    ('matrix.opsOrbit.d2', '3.1 多语种AI GEO独立站', '3.1 Multilingual AI GEO website'),
    ('matrix.opsOrbit.d3', '3.2 AI SEO外链矩阵发布', '3.2 AI SEO backlink matrix publishing'),
    ('matrix.opsOrbit.d4', '3.3 AI GEO多渠道发布（私域媒体+全网媒体）',
     '3.3 AI GEO multi-channel publishing (owned + open media)'),
    ('matrix.opsOrbit.d5', '3.4 AI企业知识库', '3.4 AI enterprise knowledge base'),
    ('matrix.opsOrbit.d6', '3.5 AI关键词蒸馏', '3.5 AI keyword distillation'),
    ('matrix.opsOrbit.d7', '3.6 根据客户画像创作GEO结构化文章（批量）',
     '3.6 Batch GEO structured articles from customer profiles'),
    ('matrix.opsOrbit.d8', '3.7 询盘管理', '3.7 Inquiry management'),
    ('matrix.opsOrbit.d9', '3.8 SEO和GEO数据报表', '3.8 SEO and GEO reporting'),

    ('matrix.bizTeam.d1', '外贸业务数字员工团队', 'Trade sales digital-employee team'),
    ('matrix.bizSkill.d1', '外贸业务专属skill技能', 'Trade-sales dedicated skills'),

    ('matrix.bizGeeklink.d1', 'GeekLink专业外贸系统', 'GeekLink professional trade system'),
    ('matrix.bizGeeklink.d2', '3.1 GeekLink外贸专家团队', '3.1 GeekLink trade expert team'),
    ('matrix.bizGeeklink.d3', '3.2 AI Agent自动获客、精准商机开发',
     '3.2 AI Agent prospecting and precision opportunity development'),
    ('matrix.bizGeeklink.d4', '3.3 AI邮箱触达（千人千面）', '3.3 AI email outreach (personalised at scale)'),
    ('matrix.bizGeeklink.d5', '3.4 AI WhatsApp触达（千人千面）', '3.4 AI WhatsApp outreach (personalised at scale)'),
    ('matrix.bizGeeklink.d6', '3.5 AI CRM客户管理和订单管理', '3.5 AI CRM and order management'),
    ('matrix.bizGeeklink.d7', '3.6 AI企业智脑', '3.6 AI enterprise brain'),

    ('matrix.crossborderA2a.d1', 'A2A跨境电商独立站', 'A2A cross-border commerce website'),
    ('matrix.crossborderA2a.d2', 'A2A跨境电商平台', 'A2A cross-border commerce platform'),
    ('matrix.crossborderOpc.d1', 'OPC及全球达人带货', 'OPC and global creator commerce'),
    ('matrix.crossborderArt.d1', 'AI视频创作和AI图片创作（消耗积分）',
     'AI video and image creation (consumes credits)'),

    ('matrix.marketingGeo.d1', 'AI企业知识库', 'AI enterprise knowledge base'),
    ('matrix.marketingGeo.d2', 'AI素材库', 'AI asset library'),
    ('matrix.marketingGeo.d3', 'AI GEO独立站站群', 'AI GEO website network'),
    ('matrix.marketingGeo.d4', 'GEO B2B联盟站群', 'GEO B2B alliance site network'),
    ('matrix.marketingGeo.d5', '关键词蒸馏', 'Keyword distillation'),
    ('matrix.marketingGeo.d6', 'AI结构化GEO内容创作', 'AI structured GEO content creation'),
    ('matrix.marketingGeo.d7', 'AI 结构化视频和图文创作（消耗积分）',
     'AI structured video and illustrated content (consumes credits)'),
    ('matrix.marketingGeo.d8', '权威媒体发布（付费）', 'Authoritative media publishing (paid)'),
    ('matrix.marketingGeo.d9', '公共媒体发布（免费）', 'Public media publishing (free)'),
    ('matrix.marketingGeo.d10', '私域媒体矩阵绑定发布（免费）', 'Owned media matrix publishing (free)'),

    # ---- 押金支付 + 收货地址闭环（2026-09-16 用户需求）----
    # 「押金10,000元/台」原先只是静态说明，现在可以直接扫码支付，支付完成后
    # 提交收货地址，地址同步到管理后台按址发货。
    ('hardware.deposit.payCta', '支付押金 ¥{{amount}}', 'Pay deposit ¥{{amount}}'),
    ('hardware.deposit.payCtaBusy', '正在创建押金订单…', 'Creating the deposit order…'),
    ('hardware.deposit.payHint',
     '点击支付押金后可微信 / 支付宝扫码付款；付款完成后填写收货地址，我们按地址发货。',
     'Tap to pay the deposit by WeChat or Alipay, then enter your shipping address — we ship to it.'),
    ('hardware.deposit.payFailed', '创建押金订单失败', 'Could not create the deposit order'),
    ('hardware.deposit.paidTip', '押金支付成功！请填写收货地址', 'Deposit paid — please enter your shipping address'),
    ('hardware.deposit.myOrder', '我的押金单', 'My deposit order'),
    ('hardware.deposit.statusCreated', '待支付', 'Awaiting payment'),
    ('hardware.deposit.statusPaid', '已支付，待填写收货地址', 'Paid — shipping address pending'),
    ('hardware.deposit.statusAddressed', '已提交收货地址，等待发货', 'Address submitted — awaiting shipment'),
    ('hardware.deposit.statusShipped', '已发货', 'Shipped'),
    ('hardware.deposit.fillAddress', '填写收货地址', 'Enter shipping address'),
    ('hardware.deposit.editAddress', '修改收货地址', 'Edit shipping address'),
    ('hardware.deposit.goAddress', '填写收货地址 →', 'Enter shipping address →'),
    ('hardware.deposit.addressTitle', '填写收货地址', 'Shipping address'),
    ('hardware.deposit.addressSubtitle',
     '押金已支付成功，请填写收货信息，我们将按此地址发货。',
     'Your deposit is paid. Enter your shipping details and we will ship to that address.'),
    ('hardware.deposit.addressLocked',
     '该押金单已发货，收货地址不可再修改。如需变更请联系客服。',
     'This deposit order has shipped, so the address can no longer be changed. Please contact support if you need to update it.'),
    ('hardware.deposit.fieldName', '收货人姓名', 'Recipient name'),
    ('hardware.deposit.fieldNamePlaceholder', '请填写真实姓名', 'Full name of the recipient'),
    ('hardware.deposit.fieldPhone', '收货人手机号', 'Recipient phone'),
    ('hardware.deposit.fieldPhonePlaceholder', '如 138xxxxxxxx', 'e.g. 138xxxxxxxx'),
    ('hardware.deposit.fieldRegion', '所在地区（省/市/区）', 'Region (province / city / district)'),
    ('hardware.deposit.fieldRegionPlaceholder', '如 广东省深圳市南山区', 'e.g. Nanshan, Shenzhen, Guangdong'),
    ('hardware.deposit.fieldDetail', '详细地址', 'Street address'),
    ('hardware.deposit.fieldDetailPlaceholder', '街道、门牌号、楼栋房号', 'Street, number, building, room'),
    ('hardware.deposit.fieldRemark', '备注（选填）', 'Notes (optional)'),
    ('hardware.deposit.fieldRemarkPlaceholder', '如开票信息、期望上门时间', 'e.g. invoice details or preferred delivery time'),
    ('hardware.deposit.errName', '请填写收货人姓名', 'Please enter the recipient name'),
    ('hardware.deposit.errPhone', '请填写有效的收货人手机号', 'Please enter a valid recipient phone number'),
    ('hardware.deposit.errDetail', '请填写详细地址', 'Please enter the street address'),
    ('hardware.deposit.submit', '提交收货地址', 'Submit address'),
    ('hardware.deposit.submitting', '提交中…', 'Submitting…'),
    ('hardware.deposit.addressFailed', '提交收货地址失败', 'Failed to submit the shipping address'),
    ('hardware.deposit.submitted', '收货地址已提交，我们将尽快安排发货', 'Address submitted — we will ship as soon as possible'),
    ('hardware.deposit.close', '关闭', 'Close'),

    ('matrix.scrollHint', '← 左右滑动查看全部 5 个档位（含外贸旗舰版）→',
     '← Scroll sideways for all 5 tiers (including Trade Flagship) →'),
]

# 需要替换（旧档位口径已作废）的既有键
OVERRIDE = [
    ('title', '选择适合你的办公盒子方案', 'Choose your GeekClaw office-box plan'),
    ('subtitle',
     '端侧算力盒子 + AI 数字员工。从通用 AI 工作站到外贸业务 / 运营双系统，按团队规模选档；积分按 token 实际消耗结算，用多少扣多少。',
     'An edge AI box plus a digital workforce. Pick the tier that fits your team — from a general AI workstation to a full trade sales + operations stack. Credits settle on real token usage, so you only pay for what you use.'),
    ('faq.q1', '不同版本之间有什么区别？',
     'What is the difference between the plans?'),
    ('faq.a1',
     '五档都包含「AI通用智能体」的全部基础能力。往上叠加的是行业智能体：国内GEO版增加国内GEO营销；外贸业务版增加外贸业务工作台；外贸运营版在此基础上增加外贸运营工作台与国际GEO系统；外贸旗舰版把业务、运营两套工作台全部打开。所有档位都含端侧算力盒子押金政策。',
     'All five tiers include the full "AI General Agents" capability set. Higher tiers stack industry agents on top: Domestic GEO adds domestic GEO marketing; Trade Sales adds the trade sales workbench; Trade Operations adds the operations workbench plus the international GEO system; Trade Flagship unlocks both trade workbenches in full. Every tier includes the edge AI box deposit policy.'),
    ('faq.q3', '如何开通或升级套餐？',
     'How do I subscribe or upgrade?'),
    ('faq.a3',
     '点击对应档位的「订阅」按钮，登录 GeekClaw 云端账号后生成微信 / 支付宝收款二维码，扫码支付成功后套餐立即生效；升级按剩余时长折算差价。',
     'Click "Subscribe" on the tier you want and sign in to your GeekClaw cloud account to get a WeChat / Alipay QR code. The plan activates as soon as payment succeeds; upgrades are pro-rated against the remaining term.'),
    ('faq.q4', '算力盒子必须购买吗？押金怎么算？',
     'Do I have to buy the edge box? How does the deposit work?'),
    ('faq.a4',
     '算力盒子是端侧算力前提，按押金 10000 元/台使用，不单独售卖。合作满 3 年后盒子归用户所有；押金可抵扣服务费或原路退回。',
     'The edge box is the local compute prerequisite and is provided against a ¥10,000 deposit — it is not sold separately. After three years of partnership the box is yours, and the deposit can be offset against service fees or refunded.'),
]


# 旧 free/pro/team 三档遗留的死键：五档方案上线后已无任何代码引用，
# 留着只会让「免费版 / 专业版 / 团队版」这类过期文案在下次改版时被误用。
REMOVE = [
    'forever',
    'upgrade',
    'getStarted',
    'recommended',
    'creditsQuota',
    'syncedFromCloud',
    'tier',
    'quota',
    'feature',
    # 文档里「包含服务」是横跨 5 个档位列的合并表头；页面改用更清晰的单行表头
    # （直接列档位名 + 价格），这个键不再需要。
    'matrix.col.plans',
]


def drop_path(node, path):
    parts = path.split('.')
    cur = node
    for p in parts[:-1]:
        cur = cur.get(p)
        if not isinstance(cur, dict):
            return False
    return cur.pop(parts[-1], None) is not None


def set_path(node, path, value):
    parts = path.split('.')
    cur = node
    for p in parts[:-1]:
        nxt = cur.get(p)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[p] = nxt
        cur = nxt
    cur[parts[-1]] = value


def main():
    problems = []
    for lang, idx in (('zh-CN', 1), ('en-US', 2)):
        path = os.path.join(LOC, lang, 'pricing.json')
        raw = open(path, encoding='utf-8').read()
        data = json.loads(raw)
        if json.dumps(data, ensure_ascii=False, indent=2) + '\n' != raw:
            problems.append(f'{lang}: 无法无损往返，已中止')
            continue
        for row in TABLE:
            set_path(data, row[0], row[idx])
        for row in OVERRIDE:
            set_path(data, row[0], row[idx])
        removed = sum(1 for k in REMOVE if drop_path(data, k))
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            f.write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
        print(
            f'{lang}: 写入 {len(TABLE)} 新增键 + {len(OVERRIDE)} 覆盖键，清理 {removed} 个死键分支'
        )

    # 键集合一致性校验
    keys = {}
    for lang in ('zh-CN', 'en-US'):
        d = json.load(open(os.path.join(LOC, lang, 'pricing.json'), encoding='utf-8'))
        flat = set()

        def walk(o, p=''):
            if isinstance(o, dict):
                for k, v in o.items():
                    walk(v, f'{p}.{k}' if p else k)
            else:
                flat.add(p)

        walk(d)
        keys[lang] = flat
    only_zh = keys['zh-CN'] - keys['en-US']
    only_en = keys['en-US'] - keys['zh-CN']
    print()
    print(f'zh-CN 键数 {len(keys["zh-CN"])} / en-US 键数 {len(keys["en-US"])}')
    if only_zh or only_en:
        print(f'  [FAIL] 仅 zh 有: {sorted(only_zh)}')
        print(f'  [FAIL] 仅 en 有: {sorted(only_en)}')
        problems.append('键集合漂移')
    else:
        print('  语言间键集合一致：drift NONE')
    if problems:
        for p in problems:
            print('ERROR:', p, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
