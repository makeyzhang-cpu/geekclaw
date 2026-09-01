/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 灵感广场 — a prompt & template market (MVP).
 *
 * Unlike 创意智能体 (which mints full pre-wired canvases), the 灵感广场 ships
 * ready-to-use *building blocks*: curated prompt recipes / style presets the
 * user can either copy to the clipboard or drop onto a fresh canvas as a
 * starter text/generator node. It deliberately carries NO expert persona and
 * NO chat surface — those live in the 专家数字分身市场 under 数字分身伙伴.
 *
 * `buildInspirationCanvas` reuses the canvas model's own factories + `flowToDoc`
 * so the produced doc is byte-shape-identical to a hand-built one.
 */

import {
  flowToDoc,
  makeGeneratorNode,
  makeOutputNode,
  makeTextNode,
  newEdgeId,
  type WorkshopFlowEdge,
  type WorkshopFlowNode,
  type XY,
} from './canvas/model';
import type { WorkshopCanvasDoc, WorkshopGeneratorMode } from './types';

/** A single market item: a copy-pasteable prompt recipe / style preset. */
export interface InspirationTemplate {
  id: string;
  titleKey: string;
  titleDefault: string;
  descKey: string;
  descDefault: string;
  /** Category chip shown on the card (文生图 / 图生视频 / 文案脚本 / 风格预设). */
  category: string;
  accent: string;
  /** Which native capability this recipe drives. */
  target: 'image' | 'video' | 'text';
  /** The ready-to-use prompt body. */
  prompt: string;
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

const IMG_PARAMS = { preset: '1:1', width: 1024, height: 1024, count: 1, quality: 'auto' } as const;
const VIDEO_PARAMS = {
  seconds: 5,
  resolution: '720p',
  aspect: '16:9',
  generate_audio: false,
  watermark: false,
} as const;

/**
 * Build a starter canvas for an inspiration item.
 * - text recipes → a single text generator node (run it to get the copy).
 * - image / video recipes → a note node (the prompt) wired into a generator
 *   node wired into an output node, so the user just hits run.
 */
export function buildInspirationCanvas(t: InspirationTemplate): WorkshopCanvasDoc {
  if (t.target === 'text') {
    const g = makeGeneratorNode({ x: 0, y: 0 } as XY, 'text' as WorkshopGeneratorMode, { prompt: t.prompt });
    return assemble([g], []);
  }
  const note = makeTextNode({ x: 0, y: 0 } as XY, {
    content: `【灵感提示词 · ${t.titleDefault}】\n${t.prompt}`,
  });
  const mode: WorkshopGeneratorMode = t.target === 'video' ? 'video' : 'image';
  const params = t.target === 'video' ? { ...VIDEO_PARAMS } : { ...IMG_PARAMS };
  const g = makeGeneratorNode({ x: 380, y: 0 } as XY, mode, { prompt: t.prompt, params });
  const out = makeOutputNode({ x: 760, y: 0 } as XY, { label: '结果预览' });
  return assemble([note, g, out], [[0, 1], [1, 2]]);
}

/** The curated prompt & template market shown under 灵感广场. */
export const INSPIRATION_TEMPLATES: InspirationTemplate[] = [
  // ─── 文生图 ───────────────────────────────────────────────────────────────
  {
    id: 'insp-ecom-hero',
    titleKey: 'workshop.inspiration.ecomHero.title',
    titleDefault: '电商白底主图',
    descKey: 'workshop.inspiration.ecomHero.desc',
    descDefault: '一键产出干净专业的商品主图。',
    category: '文生图',
    accent: '#16a34a',
    target: 'image',
    prompt:
      '一张专业电商产品主图：纯白背景，居中构图，主体清晰锐利，柔和环形布光突出质感，无阴影或极淡投影，商品细节真实，商业摄影风格，8k，超高分辨率。',
  },
  {
    id: 'insp-guochao-poster',
    titleKey: 'workshop.inspiration.guochaoPoster.title',
    titleDefault: '国潮风海报',
    descKey: 'workshop.inspiration.guochaoPoster.desc',
    descDefault: '传统文化与现代设计融合的视觉。',
    category: '文生图',
    accent: '#dc2626',
    target: 'image',
    prompt:
      '国潮风格海报：传统祥云与山水纹样，搭配现代霓虹渐变与几何排版，主色朱红与鎏金，主体是一位身着改良汉服的少女，电影级光影，细腻笔触，高级商业插画质感。',
  },
  {
    id: 'insp-healing-illust',
    titleKey: 'workshop.inspiration.healingIllust.title',
    titleDefault: '治愈系插画',
    descKey: 'workshop.inspiration.healingIllust.desc',
    descDefault: '温暖柔和的生活化小插画。',
    category: '文生图',
    accent: '#f59e0b',
    target: 'image',
    prompt:
      '治愈系扁平插画：暖色调，阳光洒进窗台的午后，一只橘猫蜷在毛毯上，绿植与咖啡杯，柔和颗粒质感，简约线条，温馨治愈氛围，留白充足。',
  },
  // ─── 图生视频 ─────────────────────────────────────────────────────────────
  {
    id: 'insp-product-motion',
    titleKey: 'workshop.inspiration.productMotion.title',
    titleDefault: '商品动态展示',
    descKey: 'workshop.inspiration.productMotion.desc',
    descDefault: '把商品图变成丝滑展示短片。',
    category: '图生视频',
    accent: '#0891b2',
    target: 'video',
    prompt:
      '将这张商品图转化为一段 5 秒高端展示视频：缓慢 360° 环绕运镜，背景渐变光晕流动，产品悬浮微旋转，金属与玻璃质感反光增强，电影级调色，丝滑高级。',
  },
  {
    id: 'insp-talking-bg',
    titleKey: 'workshop.inspiration.talkingBg.title',
    titleDefault: '口播背景动态',
    descKey: 'workshop.inspiration.talkingBg.desc',
    descDefault: '为口播人物生成动态背景。',
    category: '图生视频',
    accent: '#7c3aed',
    target: 'video',
    prompt:
      '让这张背景图自然流动起来：光影缓慢推移，粒子微光浮动，景深轻微变化，保持主体区域干净适合叠加人物口播，科技感氛围，4K，流畅不卡顿。',
  },
  // ─── 文案脚本 ─────────────────────────────────────────────────────────────
  {
    id: 'insp-ad-script',
    titleKey: 'workshop.inspiration.adScript.title',
    titleDefault: '带货口播脚本',
    descKey: 'workshop.inspiration.adScript.desc',
    descDefault: '痛点+卖点+促单的结构化口播。',
    category: '文案脚本',
    accent: '#2563eb',
    target: 'text',
    prompt:
      '写一段 30 秒带货口播脚本，结构：① 1 句戳痛点开场 ② 2 句核心卖点（数据/体验支撑）③ 1 句限时优惠促单。口语自然、有情绪、像真人推荐，不要硬广腔。产品信息：{{在此填写}}。',
  },
  {
    id: 'insp-viral-title',
    titleKey: 'workshop.inspiration.viralTitle.title',
    titleDefault: '短视频爆款标题',
    descKey: 'workshop.inspiration.viralTitle.desc',
    descDefault: '高点击的悬念/数字型标题。',
    category: '文案脚本',
    accent: '#db2777',
    target: 'text',
    prompt:
      '为这条短视频生成 10 个爆款标题，要求：前 3 秒能留住人，多用数字、悬念、反差、情绪词，适配抖音/小红书风格，避免标题党过度。视频主题：{{在此填写}}。',
  },
  {
    id: 'insp-moment-copy',
    titleKey: 'workshop.inspiration.momentCopy.title',
    titleDefault: '朋友圈种草文案',
    descKey: 'workshop.inspiration.momentCopy.desc',
    descDefault: '像朋友安利一样的真实种草。',
    category: '文案脚本',
    accent: '#059669',
    target: 'text',
    prompt:
      '写一条朋友圈种草文案：第一人称真实体验口吻，带 1-2 个具体使用场景，自然植入产品名，结尾轻互动（提问/邀约），配 2-3 个 emoji，不夸张不做作。产品：{{在此填写}}。',
  },
  // ─── 风格预设 ─────────────────────────────────────────────────────────────
  {
    id: 'insp-cyberpunk',
    titleKey: 'workshop.inspiration.cyberpunk.title',
    titleDefault: '赛博朋克',
    descKey: 'workshop.inspiration.cyberpunk.desc',
    descDefault: '霓虹、雨夜、未来都市质感。',
    category: '风格预设',
    accent: '#8b5cf6',
    target: 'image',
    prompt:
      '赛博朋克风格：霓虹灯牌密布的未来都市，雨后湿漉漉的街道反射紫蓝粉光，全息广告悬浮，飞行器穿行，主角身穿发光机能服，电影级调色，高对比，细腻赛博质感。',
  },
  {
    id: 'insp-film-retro',
    titleKey: 'workshop.inspiration.filmRetro.title',
    titleDefault: '胶片复古',
    descKey: 'workshop.inspiration.filmRetro.desc',
    descDefault: '颗粒、暖调、怀旧电影感。',
    category: '风格预设',
    accent: '#b45309',
    target: 'image',
    prompt:
      '胶片复古风格：柯达黄金时代的暖色调，明显颗粒感与轻微漏光，柔和对比，怀旧氛围，午后自然光，人物柔和虚化背景，像翻拍的老照片，文艺电影质感。',
  },
  {
    id: 'insp-ink-wash',
    titleKey: 'workshop.inspiration.inkWash.title',
    titleDefault: '水墨国风',
    descKey: 'workshop.inspiration.inkWash.desc',
    descDefault: '留白、意境、东方写意。',
    category: '风格预设',
    accent: '#0f766e',
    target: 'image',
    prompt:
      '水墨国风：写意山水，大量留白，淡墨晕染远山与孤舟，一笔兰竹点缀，意境空灵，宣纸质感，黑白灰为主辅以极少青绿，东方禅意，高雅含蓄。',
  },
  {
    id: 'insp-3d-blindbox',
    titleKey: 'workshop.inspiration.blindbox3d.title',
    titleDefault: '3D 盲盒风',
    descKey: 'workshop.inspiration.blindbox3d.desc',
    descDefault: '可爱、圆润、潮玩手办感。',
    category: '风格预设',
    accent: '#e11d48',
    target: 'image',
    prompt:
      '3D 盲盒潮玩风格：圆润可爱的角色，软糖般材质与高光，简约纯色背景，等距视角，皮克斯式体积光，干净无阴影，活泼配色，潮玩手办渲染质感，C4D 风格。',
  },
];
