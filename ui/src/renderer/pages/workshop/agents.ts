/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Creative Workshop — the unified "AI 应用市场" agent registry (方案B).
 *
 * Merges the built-in 创意智能体 (`CREATIVE_TEMPLATES`) and 灵感广场
 * (`INSPIRATION_TEMPLATES`) into a single list of runnable `MarketAgent`s. Each
 * agent carries everything the independent runner page (`/workshop/agent/:id`)
 * needs to render a form, mint a backing canvas doc, submit a creation task, and
 * poll for results — without ever forcing the user into the node canvas.
 *
 * The registry is the single source of truth for the market grid + the runner.
 * Appending agents is the only supported extension; downstream code must not
 * change existing agent semantics.
 */

import {
  DEFAULT_IMAGE_PARAMS,
  DEFAULT_TTS_PARAMS,
  DEFAULT_VIDEO_PARAMS,
} from './generation/genConstants';
import type { GenMode } from './generation/genTypes';
import { CREATIVE_TEMPLATES } from './templates';
import { INSPIRATION_TEMPLATES, type InspirationTemplate } from './inspiration';
import {
  flowToDoc,
  makeGeneratorNode,
  makeImageNode,
  newEdgeId,
  type WorkshopFlowNode,
  type XY,
} from './canvas/model';
import type { MediaCapability, WorkshopCanvasDoc, WorkshopGeneratorMode } from './types';
import type { AssetId } from '@/common/types/ids';

/** Market category chips shown above the agent grid. */
export type AgentScene = '电商主图' | '视频广告' | '文案脚本' | '数字人' | '风格预设';

export const AGENT_SCENES: AgentScene[] = ['电商主图', '视频广告', '文案脚本', '数字人', '风格预设'];

/** A single input control rendered on the runner page's form. */
export interface AgentField {
  key: string;
  label: string;
  kind: 'image' | 'text' | 'select';
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  defaultValue?: string;
}

/** A runnable agent shown in the market grid and driven by the runner page. */
export interface MarketAgent {
  id: string;
  source: 'creative' | 'inspiration';
  title: string;
  desc: string;
  accent: string;
  icon: string;
  scene: AgentScene;
  tags: string[];
  mode: GenMode;
  /** Whether the form offers an (optional) image upload for i2i / i2v. */
  acceptsImage: boolean;
  fields: AgentField[];
  defaultParams: Record<string, unknown>;
  /** Assemble the final generation prompt from the form values. */
  buildPrompt: (values: Record<string, string>) => string;
}

const VIEWPORT = { x: 96, y: 64, zoom: 1 } as const;
const BACKGROUND = 'dots' as const;

function paramsForMode(mode: GenMode): Record<string, unknown> {
  if (mode === 'image') return { ...DEFAULT_IMAGE_PARAMS };
  if (mode === 'video') return { ...DEFAULT_VIDEO_PARAMS };
  if (mode === 'tts') return { ...DEFAULT_TTS_PARAMS };
  return {};
}

function iconForCategory(category: string): string {
  switch (category) {
    case '文生图':
      return 'Picture';
    case '图生视频':
      return 'VideoTwo';
    case '文案脚本':
      return 'Edit';
    case '风格预设':
    default:
      return 'MagicWand';
  }
}

function sceneForCategory(category: string): AgentScene {
  switch (category) {
    case '文生图':
      return '电商主图';
    case '图生视频':
      return '视频广告';
    case '文案脚本':
      return '文案脚本';
    case '风格预设':
    default:
      return '风格预设';
  }
}

/** Derive the backend capability from the mode + whether a reference image is supplied. */
export function deriveCapability(
  mode: GenMode,
  hasImage: boolean
): MediaCapability {
  if (mode === 'text') return 'text';
  if (mode === 'tts') return 'tts';
  if (mode === 'video') return hasImage ? 'i2v' : 't2v';
  return hasImage ? 'i2i' : 't2i';
}

/** Build the backing canvas doc for an agent run (single generator + optional ref image). */
export function buildAgentDoc(
  agent: MarketAgent,
  prompt: string,
  refAssetId: AssetId | null
): { doc: WorkshopCanvasDoc; generatorNodeId: string } {
  const g = makeGeneratorNode({ x: 0, y: 0 } as XY, agent.mode as WorkshopGeneratorMode, {
    prompt,
    params: agent.defaultParams,
  });
  if (agent.acceptsImage && refAssetId) {
    const img = makeImageNode({ x: 0, y: 0 } as XY, { assetId: refAssetId });
    const edges = [{ id: newEdgeId(), source: img.id, target: g.id }];
    const doc = flowToDoc([img as WorkshopFlowNode, g as WorkshopFlowNode], edges, { ...VIEWPORT }, BACKGROUND);
    return { doc, generatorNodeId: g.id };
  }
  const doc = flowToDoc([g as WorkshopFlowNode], [], { ...VIEWPORT }, BACKGROUND);
  return { doc, generatorNodeId: g.id };
}

// ─── Built-in 创意智能体 (4) — explicit market entries ────────────────────────

const CREATIVE_AGENTS: MarketAgent[] = [
  {
    id: 'geekclaw-ad-video',
    source: 'creative',
    title: '电商广告视频',
    desc: '填入产品信息，一键生成带货短视频与口播配音。',
    accent: '#16a34a',
    icon: 'VideoTwo',
    scene: '视频广告',
    tags: ['电商', '广告'],
    mode: 'video',
    acceptsImage: true,
    fields: [
      { key: 'subject', label: '产品 / 品牌信息', kind: 'text', required: true, placeholder: '产品名称、核心卖点、目标人群…' },
      {
        key: 'style',
        label: '画面风格',
        kind: 'select',
        defaultValue: '高级质感',
        options: [
          { value: '高级质感', label: '高级质感' },
          { value: '白底电商图', label: '白底电商图' },
          { value: '生活化场景', label: '生活化场景' },
        ],
      },
      { key: 'image', label: '产品图（可选）', kind: 'image', required: false },
    ],
    defaultParams: { ...DEFAULT_VIDEO_PARAMS, seconds: 5 },
    buildPrompt: (v) => {
      const subject = v.subject?.trim();
      const style = v.style?.trim() || '高级质感';
      return [
        subject ? `产品/品牌信息：${subject}` : '请生成一段电商广告短视频。',
        `画面风格：${style}。`,
        '镜头缓慢推近，突出产品质感与卖点，画面高级有质感，适合商品详情页与短视频投放；并配一句 15 字以内的卖点口播文案。',
      ].join('\n');
    },
  },
  {
    id: 'geekclaw-ai-short-drama',
    source: 'creative',
    title: 'AI 全自动短剧',
    desc: '粘贴剧本，自动生成角色设定、分镜视频与台词字幕。',
    accent: '#7c3aed',
    icon: 'Movie',
    scene: '视频广告',
    tags: ['短剧', '剧本'],
    mode: 'video',
    acceptsImage: false,
    fields: [
      { key: 'script', label: '剧本 / 小说片段', kind: 'text', required: true, placeholder: '人物设定、场景、本幕剧情…' },
    ],
    defaultParams: { ...DEFAULT_VIDEO_PARAMS, seconds: 6 },
    buildPrompt: (v) => {
      const script = v.script?.trim();
      return [
        script ? `剧本/分镜：${script}` : '请基于一段小说或分镜脚本生成短剧。',
        '先生成风格统一的角色形象与关键场景参考图，再生成第一幕分镜短视频，保持角色外貌与服装一致、运镜连贯，并配贴合剧情的台词字幕（中文，口语自然，不超过 3 句）。',
      ].join('\n');
    },
  },
  {
    id: 'geekclaw-image-to-video',
    source: 'creative',
    title: '人物图转动态视频',
    desc: '上传一张人物照，让 TA 自然动起来并配上旁白。',
    accent: '#0891b2',
    icon: 'User',
    scene: '数字人',
    tags: ['数字人', '动态'],
    mode: 'video',
    acceptsImage: true,
    fields: [
      { key: 'image', label: '人物照片', kind: 'image', required: true },
      { key: 'style', label: '动态风格', kind: 'select', defaultValue: '自然微动', options: [
        { value: '自然微动', label: '自然微动（眨眼/微笑/发丝飘动）' },
        { value: '缓慢推进', label: '缓慢推进运镜' },
        { value: '轻盈舞蹈', label: '轻盈舞蹈' },
      ] },
    ],
    defaultParams: { ...DEFAULT_VIDEO_PARAMS, seconds: 4 },
    buildPrompt: (v) => {
      const style = v.style?.trim() || '自然微动';
      return `让图中的人物自然地动起来：${style}，生成一段动态视频，尽量保持原貌与画质，并配一句轻柔的中文旁白（15 字以内）。`;
    },
  },
  {
    id: 'geekclaw-prompt-reverse',
    source: 'creative',
    title: '反推视频提示词',
    desc: '描述你想要的画面，AI 反推出可复现的文生图提示词。',
    accent: '#d97706',
    icon: 'MagicWand',
    scene: '风格预设',
    tags: ['提示词', '灵感'],
    mode: 'text',
    acceptsImage: false,
    fields: [
      { key: 'subject', label: '想要复刻的画面方向', kind: 'text', required: false, placeholder: '如：赛博朋克都市夜景、清新电商白底图…' },
    ],
    defaultParams: {},
    buildPrompt: (v) => {
      const subject = v.subject?.trim();
      return [
        '请反推一段详细的文生图提示词，包含：主体、风格、光影、构图、质感、色调。用中文输出，便于直接复现类似画面。',
        subject ? `参考方向：${subject}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    },
  },
];

// ─── 灵感广场 (12) — mapped programmatically ──────────────────────────────────

function inspirationToAgent(t: InspirationTemplate): MarketAgent {
  const scene = sceneForCategory(t.category);
  const mode: GenMode = t.target === 'video' ? 'video' : t.target === 'text' ? 'text' : 'image';
  const acceptsImage = t.target === 'video';
  const fields: AgentField[] = [];
  if (acceptsImage) {
    fields.push({ key: 'image', label: '参考图（可选）', kind: 'image', required: false });
  }
  fields.push({
    key: 'subject',
    label: t.target === 'text' ? '主题 / 补充说明' : '主体描述（可选）',
    kind: 'text',
    required: false,
    placeholder: '可补充主题，留空则使用默认配方',
  });
  return {
    id: t.id,
    source: 'inspiration',
    title: t.titleDefault,
    desc: t.descDefault,
    accent: t.accent,
    icon: iconForCategory(t.category),
    scene,
    tags: [scene],
    mode,
    acceptsImage,
    fields,
    defaultParams: paramsForMode(mode),
    buildPrompt: (values) => {
      const extra = values.subject?.trim();
      return extra ? `${t.prompt}\n\n补充说明：${extra}` : t.prompt;
    },
  };
}

const INSPIRATION_AGENTS: MarketAgent[] = INSPIRATION_TEMPLATES.map(inspirationToAgent);

/** The full market registry, in display order. */
export const MARKET_AGENTS: MarketAgent[] = [...CREATIVE_AGENTS, ...INSPIRATION_AGENTS];

/** Look up a single agent by id (throws on unknown — callers validate first). */
export function getAgentById(id: string): MarketAgent | undefined {
  return MARKET_AGENTS.find((a) => a.id === id);
}

/** Keep the old template titles import referenced (title parity with the canvas templates). */
export const CREATIVE_TEMPLATE_TITLES = CREATIVE_TEMPLATES.map((t) => t.titleDefault);
