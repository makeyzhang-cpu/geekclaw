/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AI 多模型路由器（Multi-Model Router™）。
 *
 * 用户可在 UI 切换不同 AI 模型完成导购/分析任务：
 * - Qwen 3.6 (本地/通义) — 默认
 * - DeepSeek V4 (国产高性价比)
 * - ChatGPT 5.4 Mini / Nano (海外高效)
 * - 文心一言 5.0 (百度)
 * - 文生图专用模型 (Image Gen)
 *
 * 知识产权壁垒：模型路由算法、prompt 模板、风格解构体系为 GeekClaw 自研。
 * 真实推理走云端 /api/llm/chat，前端仅负责 UI 切换 + 透传。
 */

export type ModelCapability = 'chat' | 'reasoning' | 'image-gen';

export interface AIModel {
  id: string;
  /** 显示名 */
  name: string;
  /** 厂商 / 来源 */
  vendor: string;
  /** 能力 */
  capability: ModelCapability;
  /** 简介 */
  description: string;
  /** 相对速度（1=慢、2=中、3=快） */
  speedRank: 1 | 2 | 3;
  /** 是否为默认 */
  isDefault?: boolean;
  /** 国旗（用于"本土化"标识） */
  flag: string;
}

export const AI_MODELS: AIModel[] = [
  {
    id: 'qwen-3.6',
    name: 'Qwen 3.6',
    vendor: '通义 / 本地',
    capability: 'chat',
    description: '本地优先模型，中文与跨境电商场景深度优化',
    speedRank: 3,
    isDefault: true,
    flag: '🇨🇳',
  },
  {
    id: 'deepseek-v4',
    name: 'DeepSeek V4',
    vendor: 'DeepSeek',
    capability: 'reasoning',
    description: '推理强项，适合多维商品解构与复杂对比',
    speedRank: 2,
    flag: '🇨🇳',
  },
  {
    id: 'chatgpt-5.4-mini',
    name: 'ChatGPT 5.4 Mini',
    vendor: 'OpenAI',
    capability: 'chat',
    description: '高效多语种，全球通用对话体验',
    speedRank: 2,
    flag: '🇺🇸',
  },
  {
    id: 'chatgpt-5.4-nano',
    name: 'ChatGPT 5.4 Nano',
    vendor: 'OpenAI',
    capability: 'chat',
    description: '快速响应，适合轻量导购对话',
    speedRank: 3,
    flag: '🇺🇸',
  },
  {
    id: 'ernie-5.0',
    name: '文心一言 5.0',
    vendor: '百度',
    capability: 'chat',
    description: '中文场景专家，本土化推荐',
    speedRank: 2,
    flag: '🇨🇳',
  },
  {
    id: 'image-gen',
    name: '文生图专用模型',
    vendor: 'GeekClaw',
    capability: 'image-gen',
    description: '商品场景图、风格迁移，AI 配图',
    speedRank: 2,
    flag: '🎨',
  },
];

const MODEL_STORAGE_KEY = 'a2a:selected-model';

export function loadSelectedModel(): AIModel {
  if (typeof window === 'undefined') return AI_MODELS[0];
  const stored = window.localStorage.getItem(MODEL_STORAGE_KEY);
  if (stored) {
    const found = AI_MODELS.find((m) => m.id === stored);
    if (found) return found;
  }
  return AI_MODELS.find((m) => m.isDefault) ?? AI_MODELS[0];
}

export function saveSelectedModel(id: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MODEL_STORAGE_KEY, id);
}

/** 商品多维解构：6 维度叙事模板（按 analysisProfile 侧重点切换）。 */
export interface ProductAnalysisDimension {
  title: string;
  body: string;
}

export const ANALYSIS_TEMPLATES: Record<'value' | 'craft' | 'style' | 'mixed', ProductAnalysisDimension[]> = {
  value: [
    { title: '性价比梯度', body: '在同品类 ¥xxx 上下区间中性价比梯度排第 1/10。' },
    { title: '使用场景', body: '覆盖日常通勤 + 周末出行，单次使用成本约 ¥xx。' },
    { title: '目标人群', body: '学生 / 新中产 / 极简主义者 / 海淘入门用户。' },
    { title: '售后保障', body: '原产地直邮 + 7 天无理由 + 一年质保。' },
    { title: '口碑评分', body: '海外社区好评率 96%，复购率 38%。' },
    { title: '推荐问题', body: '可以聊聊：是否值得买、配套商品、跨境物流时长。' },
  ],
  craft: [
    { title: '工艺溯源', body: '源自 1990s 日本工坊无标出品，工艺师手作占比 60%。' },
    { title: '材质构成', body: '主材为意大利小牛皮 / 法国亚麻 / 日本和纸。' },
    { title: '风格解构', body: '解构主义 + 工业美学的极简剪裁。' },
    { title: '目标人群', body: '古着品质鉴赏家 / 解构主义美学追随者。' },
    { title: '搭配建议', body: '反差混搭：配柔软材质的阔身裙或露肩吊带，强化解构意图。' },
    { title: '历史背景', body: '复刻自 90 年代欧洲先锋工坊，限量编号。' },
  ],
  style: [
    { title: '风格解构', body: '解构主义 × 极简主义的视觉语言，遵循"少即是多"原则。' },
    { title: '层次叠穿', body: '外搭廓形西装或风衣，仅在领口与胸前拉链细节透露精致结构。' },
    { title: '目标人群', body: '解构主义工业美学追随者 / 极端风格践行者。' },
    { title: '日常造型', body: '一件单品即可成为视觉重心，节穿搭功力却不牺牲风格。' },
    { title: '材质质感', body: '柔软触感的半身裙或露肩吊带，用材质软硬对比强化解构意图。' },
    { title: '历史背景', body: '复刻自 90 年代欧洲工坊，设计师托比品牌标签更具收藏价值。' },
  ],
  mixed: [
    { title: '风格解构', body: '融合东方工艺与西方剪裁的混搭美学。' },
    { title: '材质构成', body: '主材 + 辅材 + 内衬三层结构，工艺细节丰富。' },
    { title: '目标人群', body: '跨境电商爱好者 / 多元文化体验者。' },
    { title: '使用场景', body: '日常通勤 + 旅行 + 社交多场景适配。' },
    { title: '本土化建议', body: '在欧美市场偏极简剪裁，在亚洲市场偏好精致细节。' },
    { title: '推荐问题', body: '是否适合送礼、对比同价位、跨境物流时长。' },
  ],
};