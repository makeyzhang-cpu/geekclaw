/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import HubPageShell from '@renderer/components/layout/HubPageShell';
import box01 from '@renderer/assets/edge-agent-box/box-01.png';
import box02 from '@renderer/assets/edge-agent-box/box-02.png';
import box03 from '@renderer/assets/edge-agent-box/box-03.png';
import box04 from '@renderer/assets/edge-agent-box/box-04.png';

/**
 * 端侧智能体盒子（Edge Agent Box）
 *
 * 展示 2 排 × 2 列 = 4 张产品图。图片为占位图，规格统一为
 * **800 × 450（16:9）**；后续替换真实图片时，直接覆盖
 * `ui/src/renderer/assets/edge-agent-box/box-01..04.*` 即可（保持命名），
 * 若换用其他格式（如 .png）需同步改这里的 import 扩展名。
 */
const BOX_IMAGES: { src: string; title: string; desc: string }[] = [
  {
    src: box01,
    title: '产品外观',
    desc: '小体积机身，桌面即放，插电即用',
  },
  {
    src: box02,
    title: '接口特写',
    desc: '丰富接口扩展，外接显示与存储',
  },
  {
    src: box03,
    title: '部署场景',
    desc: '本地部署 26B 及以上大模型，断网可用',
  },
  {
    src: box04,
    title: '算力参数',
    desc: '端侧算力承载云端能力，成本更低',
  },
];

const LobsterPage: React.FC = () => {
  const { t } = useTranslation();

  return (
    <HubPageShell
      title={t('edgeAgentBox.title', {
        defaultValue: '端侧算力智能体龙虾盒子— 既省钱、能赚钱、更值钱',
      })}
      subtitle={t('edgeAgentBox.subtitle', {
        defaultValue:
          '小盒子能装下云端算力，本地部署26B或以上大模型，插电即用，内置GeekClaw AI桌面办公系统，不联网AI也能干活！',
      })}
      maxWidthClass='md:max-w-1600px'
    >
      <div className='grid grid-cols-1 md:grid-cols-2 gap-16px'>
        {BOX_IMAGES.map((item, idx) => (
          <div
            key={item.src}
            className='border border-[var(--color-border-2)] rounded-12px bg-[var(--color-bg-2)] overflow-hidden transition-all hover:border-primary-6 hover:shadow-[0_4px_16px_rgba(var(--primary-6),0.14)]'
          >
            <div className='w-full aspect-[16/9] bg-fill-1 overflow-hidden'>
              <img
                src={item.src}
                alt={`${item.title} ${idx + 1}`}
                className='block w-full h-full object-cover'
                draggable={false}
              />
            </div>
            <div className='px-16px py-12px'>
              <div className='text-15px font-600 text-t-primary'>{item.title}</div>
              <div className='mt-4px text-13px leading-20px text-t-secondary'>{item.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </HubPageShell>
  );
};

export default LobsterPage;
