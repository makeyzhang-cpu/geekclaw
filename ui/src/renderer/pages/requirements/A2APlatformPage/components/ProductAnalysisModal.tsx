/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@arco-design/web-react';
import { Close } from '@icon-park/react';
import { A2AProduct } from '../catalog';
import { ANALYSIS_TEMPLATES, AIModel } from '../models';
import { A2A_THEME } from '../theme';

interface Props {
  product: A2AProduct | null;
  model: AIModel;
  /** 'value' | 'craft' | 'style' | 'mixed' — 决定解构侧重 */
  analysisProfile: 'value' | 'craft' | 'style' | 'mixed';
  onClose: () => void;
}

/**
 * 商品 AI 多维解构弹窗（核心 IP 卖点）。
 *
 * 参考 ukenmall 商品详情：
 * - 反差混搭 / 层次叠穿 / 归国人群 / 解构主义工业美学追随者 ...
 * - 底部 3 个推荐问题（规格材料、对比、是否适合送礼）
 */
const ProductAnalysisModal: React.FC<Props> = ({ product, model, analysisProfile, onClose }) => {
  const { t } = useTranslation();
  if (!product) return null;

  const dimensions = ANALYSIS_TEMPLATES[analysisProfile];

  return (
    <Modal
      visible={!!product}
      onCancel={onClose}
      footer={null}
      closable={false}
      className='a2a-analysis-modal'
      style={{ borderRadius: 20, overflow: 'hidden', maxWidth: 680, width: '92vw' }}
    >
      <div className='flex flex-col gap-20px max-h-[80vh] overflow-y-auto p-4px'>
        {/* 标题区 */}
        <div className='flex items-start justify-between gap-12px'>
          <div className='flex flex-col gap-6px flex-1 min-w-0'>
            <div className='flex items-center gap-6px'>
              <span className='inline-flex items-center rounded-16px px-10px py-3px text-11px font-600' style={{ background: A2A_THEME.primarySoft, color: A2A_THEME.primaryStrong }}>
                {model.name} · AI 解构
              </span>
              <span className='text-11px text-t-tertiary'>{model.vendor}</span>
            </div>
            <h2 className='text-20px font-700 leading-tight text-t-primary'>{product.name}</h2>
            <div className='text-12px text-t-tertiary'>{product.tags.join(' · ')}</div>
          </div>
          <button
            type='button'
            onClick={onClose}
            className='flex-none cursor-pointer border-none bg-transparent p-6px rounded-10px hover:bg-[var(--color-fill-2)] transition-colors'
          >
            <Close theme='outline' size='18' />
          </button>
        </div>

        {/* 解构维度 */}
        <div className='flex flex-col gap-12px'>
          {dimensions.map((dim, idx) => (
            <div key={idx} className='rounded-12px bg-[var(--color-fill-1)] p-14px'>
              <div className='text-13px font-600 text-[var(--color-primary-6)] mb-4px'>
                {dim.title}
              </div>
              <div className='text-13px leading-22px text-t-secondary'>
                {dim.body}
              </div>
            </div>
          ))}
        </div>

        {/* 推荐问题 */}
        <div className='flex flex-col gap-10px border-t border-solid border-[var(--color-border-2)] pt-16px'>
          <div className='text-13px font-600 text-t-primary'>
            {t('requirements.a2a.platform.analysis.followupTitle')}
          </div>
          <div className='flex flex-col gap-6px'>
            <button
              type='button'
              onClick={onClose}
              className='text-left rounded-10px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-1)] px-12px py-10px text-13px text-t-secondary cursor-pointer transition-colors hover:border-[var(--color-primary-5)] hover:text-[var(--color-primary-6)]'
            >
              {t('requirements.a2a.platform.analysis.q1')}
            </button>
            <button
              type='button'
              onClick={onClose}
              className='text-left rounded-10px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-1)] px-12px py-10px text-13px text-t-secondary cursor-pointer transition-colors hover:border-[var(--color-primary-5)] hover:text-[var(--color-primary-6)]'
            >
              {t('requirements.a2a.platform.analysis.q2')}
            </button>
            <button
              type='button'
              onClick={onClose}
              className='text-left rounded-10px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-1)] px-12px py-10px text-13px text-t-secondary cursor-pointer transition-colors hover:border-[var(--color-primary-5)] hover:text-[var(--color-primary-6)]'
            >
              {t('requirements.a2a.platform.analysis.q3')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default ProductAnalysisModal;