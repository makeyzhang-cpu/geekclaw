/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Creative Workshop — built-in creative workflow templates.
 *
 * Each template mints a pre-wired canvas doc (nodes + edges + starter prompts)
 * so a user can open 创意工坊, pick a workflow, and immediately get a canvas
 * whose generation steps are already laid out — they only fill in the subject
 * and hit run. The workflows reuse GeekClaw's native media capabilities
 * (image / video / tts / text generation via `nomi_workshop_generate`), never
 * the Aibote-specific tooling of the original community skills.
 *
 * Node/edge assembly reuses the canvas model's own factories + `flowToDoc`, so
 * the produced doc is byte-shape-identical to one a user would build by hand.
 */

import {
  flowToDoc,
  makeGeneratorNode,
  makeImageNode,
  makeOutputNode,
  makeTextNode,
  newEdgeId,
  type WorkshopFlowEdge,
  type WorkshopFlowNode,
  type XY,
} from './canvas/model';
import type { WorkshopCanvasDoc, WorkshopGeneratorMode } from './types';

/** Metadata + a doc builder for one creative template. */
export interface CreativeTemplate {
  id: string;
  /** i18n key (zh-CN / en-US may override); falls back to the `*Default`. */
  titleKey: string;
  titleDefault: string;
  descKey: string;
  descDefault: string;
  /** Accent color (CSS) used for the template card + icon chip. */
  accent: string;
  /** icon-park (outline) icon name. */
  icon: string;
  build: () => WorkshopCanvasDoc;
}

const VIEWPORT = { x: 96, y: 64, zoom: 1 } as const;
const BACKGROUND = 'dots' as const;

/** Assemble a persistable doc from flow nodes + [sourceIdx, targetIdx] pairs. */
function assemble(nodes: WorkshopFlowNode[], links: Array<[number, number]>): WorkshopCanvasDoc {
  const edges: WorkshopFlowEdge[] = links.map(([from, to]) => ({
    id: newEdgeId(),
    source: nodes[from].id,
    target: nodes[to].id,
  }));
  return flowToDoc(nodes, edges, { ...VIEWPORT }, BACKGROUND);
}

/** Mint a generator card already carrying a starter prompt + sensible params. */
function gen(
  pos: XY,
  mode: WorkshopGeneratorMode,
  prompt: string,
  params: Record<string, unknown> = {}
): WorkshopFlowNode {
  return makeGeneratorNode(pos, mode, { prompt, params });
}

const IMG_PARAMS = { preset: '1:1', width: 1024, height: 1024, count: 1, quality: 'auto' } as const;
const VIDEO_PARAMS = {
  seconds: 5,
  resolution: '720p',
  aspect: '16:9',
  generate_audio: false,
  watermark: false,
} as const;

// ─── Template 1 — 电商广告视频 ────────────────────────────────────────────────

function buildAdVideo(): WorkshopCanvasDoc {
  const info = makeTextNode({ x: 0, y: 0 }, {
    content: '【产品/品牌信息】\n在这里填写：产品名称、核心卖点、目标人群、想要的画面风格（如：白底电商图 / 生活化场景）。',
  });
  const hero = gen({ x: 380, y: 0 }, 'image',
    '根据左侧产品信息，生成一张电商风格的高清主图：主体清晰、突出卖点、光线柔和、适合商品详情页。',
    { ...IMG_PARAMS });
  const clip = gen({ x: 760, y: 0 }, 'video',
    '将上方产品主图转化为一段约 5 秒的电商广告短视频：镜头缓慢推近，突出产品质感与卖点，画面高级有质感。',
    { ...VIDEO_PARAMS });
  const voice = gen({ x: 1140, y: 60 }, 'tts',
    '为这段广告写一句 15 字以内的卖点口播文案，并朗读出来（例如：限时好物，闭眼入不踩雷）。');
  return assemble([info, hero, clip, voice], [[0, 1], [1, 2], [0, 3]]);
}

// ─── Template 2 — AI 全自动短剧 ───────────────────────────────────────────────

function buildShortDrama(): WorkshopCanvasDoc {
  const script = makeTextNode({ x: 0, y: 0 }, {
    content: '【剧本 / 小说片段】\n粘贴一段小说或分镜脚本，说明：人物设定、场景、本幕剧情。后续节点会基于它生成统一的角色与画面。',
  });
  const char = gen({ x: 380, y: 0 }, 'image',
    '根据左侧剧本，生成风格统一的主要角色形象（男女主）与关键场景参考图，保持人物一致、光影统一。',
    { ...IMG_PARAMS });
  const scene = gen({ x: 760, y: 0 }, 'video',
    '基于上方角色与场景参考图，生成第一幕的分镜短视频，保持角色外貌与服装一致，运镜连贯。',
    { ...VIDEO_PARAMS, seconds: 6 });
  const subtitle = gen({ x: 760, y: 300 }, 'text',
    '根据剧本为这一幕生成贴合剧情的台词字幕（中文，口语自然，不超过 3 句）。', {});
  const output = makeOutputNode({ x: 1140, y: 140 }, { label: '成片预览' });
  return assemble([script, char, scene, subtitle, output], [[0, 1], [1, 2], [0, 3], [2, 4], [3, 4]]);
}

// ─── Template 3 — 人物图片生成动态视频 ────────────────────────────────────────

function buildImageToVideo(): WorkshopCanvasDoc {
  const upload = makeImageNode({ x: 0, y: 0 }, {
    assetId: null,
    caption: '① 在此拖入 / 上传一张人物照片（清晰正脸最佳）。',
  });
  const motion = gen({ x: 380, y: 0 }, 'video',
    '让图中的人物自然地动起来：轻微眨眼、微笑、发丝飘动，生成一段动态视频，尽量保持原貌与画质。',
    { ...VIDEO_PARAMS, seconds: 4 });
  const narration = gen({ x: 760, y: 60 }, 'tts',
    '为这段动态视频配一句轻柔的旁白（中文，15 字以内）。');
  const output = makeOutputNode({ x: 760, y: 320 }, { label: '成片预览' });
  return assemble([upload, motion, narration, output], [[0, 1], [1, 2], [1, 3]]);
}

// ─── Template 4 — 反推视频提示词（图模式） ────────────────────────────────────

function buildPromptReverse(): WorkshopCanvasDoc {
  const guide = makeTextNode({ x: 0, y: 0 }, {
    content: '【使用说明】\n在右侧上传一张你喜欢的图，AI 会反推出可用于复现类似画面的文生图提示词。视频模式需后续抽帧能力，当前先用图模式。',
  });
  const ref = makeImageNode({ x: 380, y: 0 }, {
    assetId: null,
    caption: '① 上传参考图。',
  });
  const reverse = gen({ x: 760, y: 0 }, 'text',
    '请仔细观察这张图，反推出一段详细的文生图提示词，包含：主体、风格、光影、构图、质感、色调。用中文输出，便于直接复现类似画面。', {});
  return assemble([guide, ref, reverse], [[1, 2], [0, 2]]);
}

/** The ordered template gallery shown on the 创意工坊 home page. */
export const CREATIVE_TEMPLATES: CreativeTemplate[] = [
  {
    id: 'geekclaw-ad-video',
    titleKey: 'workshop.template.adVideo.title',
    titleDefault: '电商广告视频',
    descKey: 'workshop.template.adVideo.desc',
    descDefault: '产品信息 → 主图 → 广告短片 → 口播配音，一键生成带货视频。',
    accent: '#16a34a',
    icon: 'VideoTwo',
    build: buildAdVideo,
  },
  {
    id: 'geekclaw-ai-short-drama',
    titleKey: 'workshop.template.shortDrama.title',
    titleDefault: 'AI 全自动短剧',
    descKey: 'workshop.template.shortDrama.desc',
    descDefault: '剧本 → 角色设定图 → 分镜视频 → 台词字幕，自动续写短剧。',
    accent: '#7c3aed',
    icon: 'Movie',
    build: buildShortDrama,
  },
  {
    id: 'geekclaw-image-to-video',
    titleKey: 'workshop.template.imageToVideo.title',
    titleDefault: '人物图转动态视频',
    descKey: 'workshop.template.imageToVideo.desc',
    descDefault: '上传一张人物照，让 TA 自然动起来并配上旁白。',
    accent: '#0891b2',
    icon: 'User',
    build: buildImageToVideo,
  },
  {
    id: 'geekclaw-prompt-reverse',
    titleKey: 'workshop.template.promptReverse.title',
    titleDefault: '反推视频提示词',
    descKey: 'workshop.template.promptReverse.desc',
    descDefault: '上传参考图，AI 反推出可复现画面的文生图提示词。',
    accent: '#d97706',
    icon: 'MagicWand',
    build: buildPromptReverse,
  },
];
