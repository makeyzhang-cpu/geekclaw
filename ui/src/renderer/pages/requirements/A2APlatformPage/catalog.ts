/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A2A 跨境商城 mock 商品库（6 大类 24 款）。
 *
 * 数据形态对齐手机端调研的 A2A 跨境商城 MVP-1（买家 Agent 导购闭环）：
 * 用户用自然语言提出需求 → Agent 找货 → 比价 → 下单 → 支付。
 * 该目录是纯前端 mock 数据，后续可平滑替换为后端 `/api/products`。
 */

export interface A2AProduct {
  id: string;
  name: string;
  category: string;
  origin: string;
  price_cny: number;
  rating: number;
  ship_days: number;
  stock: number;
  tags: string[];
}

/** 品类关键词表（对齐调研 agent.py 的分类规则）。 */
export const CATEGORIES: Record<string, string[]> = {
  '3C数码': ['手机', '电脑', '耳机', '相机', '平板', '键盘', '鼠标', '充电', '数码', '笔记本', '音箱', '手表'],
  美妆个护: ['口红', '面膜', '护肤', '香水', '化妆', '美妆', '洗护', '精华', '彩妆', '防晒'],
  家居生活: ['台灯', '枕头', '床品', '收纳', '杯子', '锅', '家居', '抱枕', '香薰', '保鲜', '地毯', '窗帘'],
  母婴用品: ['奶粉', '尿不湿', '纸尿裤', '婴儿', '母婴', '玩具', '辅食', '宝宝', '奶瓶'],
  服饰鞋包: ['衣服', '外套', '鞋', '包', '牛仔', '卫衣', '连衣裙', 'T恤', '服饰', '衬衫', '手表'],
  食品保健: ['保健品', '维生素', '零食', '咖啡', '保健', '鱼油', '蛋白', '坚果', '巧克力'],
};

export const CATEGORY_KEYS = Object.keys(CATEGORIES);

export const PRODUCTS: A2AProduct[] = [
  // ── 3C数码 ────────────────────────────────────────────────
  {
    id: 'c001',
    name: 'Sony WH-1000XM5 降噪耳机',
    category: '3C数码',
    origin: '日本',
    price_cny: 2199,
    rating: 4.9,
    ship_days: 7,
    stock: 32,
    tags: ['降噪', '耳机', '索尼', '蓝牙'],
  },
  {
    id: 'c002',
    name: 'MacBook Air M3 13.6 英寸',
    category: '3C数码',
    origin: '美国',
    price_cny: 8999,
    rating: 4.8,
    ship_days: 10,
    stock: 8,
    tags: ['笔记本', '苹果', 'M3'],
  },
  {
    id: 'c003',
    name: 'DJI Osmo Pocket 3 口袋云台相机',
    category: '3C数码',
    origin: '中国',
    price_cny: 3499,
    rating: 4.8,
    ship_days: 3,
    stock: 15,
    tags: ['相机', '大疆', '云台', 'vlog'],
  },
  {
    id: 'c004',
    name: 'Anker 65W 氮化镓充电器套装',
    category: '3C数码',
    origin: '中国',
    price_cny: 199,
    rating: 4.7,
    ship_days: 3,
    stock: 120,
    tags: ['充电', '氮化镓', '快充'],
  },
  // ── 美妆个护 ──────────────────────────────────────────────
  {
    id: 'b001',
    name: '兰蔻菁纯口红 #196',
    category: '美妆个护',
    origin: '法国',
    price_cny: 285,
    rating: 4.7,
    ship_days: 8,
    stock: 60,
    tags: ['口红', '兰蔻', '法国'],
  },
  {
    id: 'b002',
    name: 'SK-II 神仙水精华 230ml',
    category: '美妆个护',
    origin: '日本',
    price_cny: 1190,
    rating: 4.8,
    ship_days: 7,
    stock: 24,
    tags: ['精华', '神仙水', 'SK-II'],
  },
  {
    id: 'b003',
    name: '理肤泉 B5 修复霜 100ml',
    category: '美妆个护',
    origin: '法国',
    price_cny: 149,
    rating: 4.6,
    ship_days: 8,
    stock: 200,
    tags: ['护肤', '修复', '理肤泉'],
  },
  {
    id: 'b004',
    name: '祖玛珑 蓝风铃香水 30ml',
    category: '美妆个护',
    origin: '英国',
    price_cny: 680,
    rating: 4.7,
    ship_days: 9,
    stock: 18,
    tags: ['香水', '祖玛珑', '蓝风铃'],
  },
  // ── 家居生活 ──────────────────────────────────────────────
  {
    id: 'h001',
    name: 'MUJI 香薰加湿器（大）',
    category: '家居生活',
    origin: '日本',
    price_cny: 328,
    rating: 4.6,
    ship_days: 6,
    stock: 45,
    tags: ['香薰', '加湿器', 'MUJI'],
  },
  {
    id: 'h002',
    name: '网易严选 乳胶枕（护颈款）',
    category: '家居生活',
    origin: '泰国',
    price_cny: 199,
    rating: 4.5,
    ship_days: 5,
    stock: 88,
    tags: ['枕头', '乳胶', '护颈'],
  },
  {
    id: 'h003',
    name: '康宁 晶彩透明玻璃锅 2.2L',
    category: '家居生活',
    origin: '美国',
    price_cny: 459,
    rating: 4.7,
    ship_days: 9,
    stock: 30,
    tags: ['锅', '康宁', '玻璃锅'],
  },
  {
    id: 'h004',
    name: '野兽派 永生花礼盒（玫瑰）',
    category: '家居生活',
    origin: '中国',
    price_cny: 399,
    rating: 4.6,
    ship_days: 3,
    stock: 26,
    tags: ['永生花', '礼盒', '野兽派'],
  },
  // ── 母婴用品 ──────────────────────────────────────────────
  {
    id: 'm001',
    name: 'a2 白金版婴幼儿奶粉 3 段 900g',
    category: '母婴用品',
    origin: '新西兰',
    price_cny: 268,
    rating: 4.8,
    ship_days: 10,
    stock: 40,
    tags: ['奶粉', 'a2', '新西兰'],
  },
  {
    id: 'm002',
    name: '花王 妙而舒纸尿裤 L54 片',
    category: '母婴用品',
    origin: '日本',
    price_cny: 129,
    rating: 4.7,
    ship_days: 6,
    stock: 150,
    tags: ['纸尿裤', '花王', '妙而舒'],
  },
  {
    id: 'm003',
    name: '费雪 婴儿钢琴健身架',
    category: '母婴用品',
    origin: '美国',
    price_cny: 339,
    rating: 4.7,
    ship_days: 8,
    stock: 22,
    tags: ['玩具', '费雪', '健身架'],
  },
  {
    id: 'm004',
    name: '贝亲 宽口径玻璃奶瓶 240ml',
    category: '母婴用品',
    origin: '日本',
    price_cny: 89,
    rating: 4.8,
    ship_days: 5,
    stock: 200,
    tags: ['奶瓶', '贝亲', '玻璃'],
  },
  // ── 服饰鞋包 ──────────────────────────────────────────────
  {
    id: 'f001',
    name: '优衣库 摇粒绒拉链外套',
    category: '服饰鞋包',
    origin: '日本',
    price_cny: 199,
    rating: 4.6,
    ship_days: 6,
    stock: 300,
    tags: ['外套', '优衣库', '摇粒绒'],
  },
  {
    id: 'f002',
    name: 'New Balance 2002R 复古跑鞋',
    category: '服饰鞋包',
    origin: '美国',
    price_cny: 899,
    rating: 4.7,
    ship_days: 9,
    stock: 35,
    tags: ['鞋', 'New Balance', '复古'],
  },
  {
    id: 'f003',
    name: 'Coach 山茶花链条包',
    category: '服饰鞋包',
    origin: '美国',
    price_cny: 3299,
    rating: 4.7,
    ship_days: 12,
    stock: 10,
    tags: ['包', 'Coach', '链条包'],
  },
  {
    id: 'f004',
    name: '三宅一生 BAO BAO 托特包',
    category: '服饰鞋包',
    origin: '日本',
    price_cny: 2680,
    rating: 4.8,
    ship_days: 10,
    stock: 12,
    tags: ['包', '三宅一生', 'BAOBAO'],
  },
  // ── 食品保健 ──────────────────────────────────────────────
  {
    id: 'g001',
    name: 'Swisse 深海鱼油软胶囊 400 粒',
    category: '食品保健',
    origin: '澳大利亚',
    price_cny: 189,
    rating: 4.7,
    ship_days: 11,
    stock: 90,
    tags: ['鱼油', '保健品', 'Swisse'],
  },
  {
    id: 'g002',
    name: 'GNC 维生素 C 咀嚼片 500mg',
    category: '食品保健',
    origin: '美国',
    price_cny: 99,
    rating: 4.6,
    ship_days: 9,
    stock: 130,
    tags: ['维生素', 'GNC', 'VC'],
  },
  {
    id: 'g003',
    name: '瑞士莲 软心巧克力礼盒 600g',
    category: '食品保健',
    origin: '瑞士',
    price_cny: 158,
    rating: 4.8,
    ship_days: 8,
    stock: 75,
    tags: ['巧克力', '瑞士莲', '零食'],
  },
  {
    id: 'g004',
    name: '星巴克 中度烘焙咖啡豆 1.13kg',
    category: '食品保健',
    origin: '美国',
    price_cny: 218,
    rating: 4.7,
    ship_days: 9,
    stock: 55,
    tags: ['咖啡', '星巴克', '咖啡豆'],
  },
];
