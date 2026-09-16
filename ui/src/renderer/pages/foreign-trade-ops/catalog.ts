/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 外贸单证工具箱目录。
 *
 * 页面本体是随包内置的静态单证生成器（`ui/public/trade-docs/*.html`，离线可用），
 * 本文件只负责「目录 + 分组 + 中英文名称 + 一句话说明」，用页内 iframe 加载。
 *
 * 分组按跟单作业顺序排列：先报价定合同 → 再做货物单据 → 然后运输 → 最后合规证书，
 * 实用工具单独一组，符合外贸业务员实际的下单推进节奏。
 */

export type TradeDocGroupId = 'quote' | 'goods' | 'shipping' | 'certificate' | 'tools';

/** 与 `common.tradeFollowUp.group.*` 文案键一一对应。 */
export const TRADE_DOC_GROUPS: TradeDocGroupId[] = ['quote', 'goods', 'shipping', 'certificate', 'tools'];

export interface TradeDocItem {
  /** 页面文件名（trade-docs 目录下），同时用作选中态主键。 */
  file: string;
  /** 中文名。 */
  zh: string;
  /** 英文名。 */
  en: string;
  /** 中文一句话说明（卡片与搜索用）。 */
  zhDesc: string;
  /** 英文一句话说明。 */
  enDesc: string;
  group: TradeDocGroupId;
  /** 成交环节高频单证，界面上加「常用」标记。 */
  hot?: boolean;
}

export const TRADE_DOCS: TradeDocItem[] = [
  // —— 报价与合同 ——
  {
    file: 'commercial-quotation.html',
    zh: '商业报价单',
    en: 'Commercial Quotation',
    zhDesc: '给客户的正式报价单：单价、贸易术语、有效期与付款方式一页说清。',
    enDesc: 'A formal quotation with unit price, Incoterm, validity and payment terms.',
    group: 'quote',
    hot: true,
  },
  {
    file: 'cost-estimation.html',
    zh: '成本估算单',
    en: 'Cost Estimation',
    zhDesc: '核算出厂价、运费、保险与杂费的构成，报价前先把底价和利润率算明白。',
    enDesc: 'Break down ex-works cost, freight, insurance and fees to protect your margin.',
    group: 'quote',
  },
  {
    file: 'proforma-invoice.html',
    zh: '形式发票 PI',
    en: 'Proforma Invoice',
    zhDesc: '客户开信用证、付定金用的预估发票，多数外贸订单的第一张单证。',
    enDesc: 'The pre-shipment invoice customers use for L/C or deposit — the first doc in most deals.',
    group: 'quote',
    hot: true,
  },
  {
    file: 'trade-contract.html',
    zh: '外贸合同',
    en: 'Trade Contract',
    zhDesc: '中英对照销售合同，覆盖质量、包装、装运、索赔与仲裁条款。',
    enDesc: 'Bilingual sales contract covering quality, packing, shipment, claims and arbitration.',
    group: 'quote',
  },

  // —— 货物单据 ——
  {
    file: 'commercial-invoice.html',
    zh: '商业发票 CI',
    en: 'Commercial Invoice',
    zhDesc: '清关与结汇的核心单据：含 HS 编码、商品明细与金额汇总。',
    enDesc: 'The core clearance and settlement document with HS codes, line items and totals.',
    group: 'goods',
    hot: true,
  },
  {
    file: 'packing-list.html',
    zh: '装箱单',
    en: 'Packing List',
    zhDesc: '件数、毛净重与体积自动汇总，报关、提货与客户收货都要用。',
    enDesc: 'Auto-totalled packages, gross/net weight and CBM for customs and receiving.',
    group: 'goods',
    hot: true,
  },
  {
    file: 'commercial-packing-list.html',
    zh: '详细装箱单',
    en: 'Detailed Packing List',
    zhDesc: '逐箱列明规格与重量，适合合规查验与客户仓库分货。',
    enDesc: 'Carton-by-carton detail for compliance checks and warehouse sorting.',
    group: 'goods',
  },
  {
    file: 'shipping-mark.html',
    zh: '唛头生成器',
    en: 'Shipping Mark Generator',
    zhDesc: '生成规范运输唛头，避免货到目的港认不出货、贴错标。',
    enDesc: 'Generate standard shipping marks so cartons are never mis-sorted at the port.',
    group: 'goods',
  },

  // —— 运输单据 ——
  {
    file: 'bill-of-lading.html',
    zh: '提单',
    en: 'Bill of Lading',
    zhDesc: '海运提单制作与核对：船东、货代、收货人与通知方条款。',
    enDesc: 'Draft and check B/L details: carrier, forwarder, consignee and notify party.',
    group: 'shipping',
    hot: true,
  },
  {
    file: 'shipper-letter-instruction.html',
    zh: '发货人委托书',
    en: "Shipper's Letter of Instruction",
    zhDesc: '正式委托货代订舱、报关的指令文件，事后追责有依据。',
    enDesc: 'The formal instruction that authorises your forwarder to book and clear cargo.',
    group: 'shipping',
  },
  {
    file: 'customs-declaration.html',
    zh: '报关单',
    en: 'Customs Declaration',
    zhDesc: '整理出口报关要素：成交方式、监管方式、商品编码与数量。',
    enDesc: 'Assemble export declaration data: terms, supervision mode, HS codes and quantities.',
    group: 'shipping',
  },

  // —— 合规证书 ——
  {
    file: 'certificate-of-origin.html',
    zh: '原产地证明',
    en: 'Certificate of Origin',
    zhDesc: '客户享受关税优惠的关键证明，含原产地标准与申报要素。',
    enDesc: 'The key document for tariff preference, with origin criteria and declarations.',
    group: 'certificate',
    hot: true,
  },
  {
    file: 'inspection-certificate.html',
    zh: '检验证书',
    en: 'Inspection Certificate',
    zhDesc: '第三方检验合格证明，信用证与客户质量条款常要求提供。',
    enDesc: 'Third-party inspection proof, often required by L/C and quality clauses.',
    group: 'certificate',
  },
  {
    file: 'fumigation-certificate.html',
    zh: '熏蒸证书',
    en: 'Fumigation Certificate',
    zhDesc: '木质包装与农产品出口的熏蒸处理证明，缺了会被退运。',
    enDesc: 'Fumigation proof for wood packaging and agri exports — missing it means rejection.',
    group: 'certificate',
  },
  {
    file: 'beneficiary-certificate.html',
    zh: '受益人证明',
    en: 'Beneficiary Certificate',
    zhDesc: '按信用证要求出具的受益人声明，交单议付必备。',
    enDesc: 'Beneficiary statement required by L/C for document presentation.',
    group: 'certificate',
  },
  {
    file: 'insurance-policy.html',
    zh: '保险单',
    en: 'Insurance Policy',
    zhDesc: 'CIF 项下货物运输险单据，含险别、保额与赔款地点。',
    enDesc: 'Cargo insurance document under CIF: coverage, amount and claim payable at.',
    group: 'certificate',
  },

  // —— 实用工具 ——
  {
    file: 'currency-converter.html',
    zh: '汇率换算器',
    en: 'Currency Converter',
    zhDesc: '外币换算与报价折算，报 CIF 价、算利润时随手可用。',
    enDesc: 'Convert currencies and reprice quotations on the fly.',
    group: 'tools',
  },
  {
    file: 'payment-calculator.html',
    zh: '付款条款计算器',
    en: 'Payment Terms Calculator',
    zhDesc: '按 T/T、L/C 等条款测算各节点应收金额与时间。',
    enDesc: 'Work out amounts and dates for each milestone under T/T, L/C and more.',
    group: 'tools',
  },
  {
    file: 'invoice-number.html',
    zh: '发票编号生成器',
    en: 'Invoice Number Generator',
    zhDesc: '按既定规则生成不重号的发票 / 合同编号，财务对账清晰。',
    enDesc: 'Generate consistent, non-duplicating invoice and contract numbers.',
    group: 'tools',
  },
];

/** 单证页面的内嵌地址（public 目录，随前端一起打包）。 */
export const TRADE_DOC_BASE = '/trade-docs/';

export function tradeDocUrl(file: string): string {
  return `${TRADE_DOC_BASE}${file}`;
}
