/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@arco-design/web-react';
import { Broadcast } from '@icon-park/react';
import classNames from 'classnames';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';

interface SiderSocialMatrixEntryProps {
  isMobile: boolean;
  isActive: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onClick: () => void;
}

/**
 * SiderSocialMatrixEntry — AI出海智能体分组下的「海外社媒矩阵工作台」入口。
 *
 * 定位：把同一份出海内容一次创作、按平台差异化改写成多个版本，投放到
 * LinkedIn / Facebook / Instagram / YouTube / X / TikTok 组成的账号矩阵，
 * 并按队列与日历排期自动发布、回收互动指标。
 *
 * 与相邻的两个出海板块区分：
 * - 「B2B外贸跟单工作台」是单证与订单履约，不发内容；
 * - 「外贸人知识库」是随包内置的模板资源库，只读不下发。
 * 本入口是唯一对外的内容分发通道（矩阵账号 + 排期 + 指标）。
 */
const SiderSocialMatrixEntry: React.FC<SiderSocialMatrixEntryProps> = ({
  isMobile,
  isActive,
  collapsed,
  siderTooltipProps,
  onClick,
}) => {
  const { t } = useTranslation();
  const label = t('common.siderRail.socialMatrix', { defaultValue: '海外社媒矩阵工作台' });

  if (collapsed) {
    return (
      <Tooltip {...siderTooltipProps} content={label} position='right'>
        <div
          className={classNames(
            'w-full h-32px flex items-center justify-center cursor-pointer transition-colors rd-8px text-t-primary',
            isActive ? '!bg-primary-1 !text-primary-6' : 'hover:bg-fill-2 active:bg-fill-3'
          )}
          onClick={onClick}
        >
          <Broadcast
            theme='outline'
            size='20'
            fill='currentColor'
            className='block leading-none shrink-0'
            style={{ lineHeight: 0 }}
          />
        </div>
      </Tooltip>
    );
  }

  return (
    <Tooltip {...siderTooltipProps} content={label} position='right'>
      <div
        className={classNames(
          'box-border group h-32px w-full flex items-center justify-start gap-8px pl-10px pr-8px rd-0.5rem cursor-pointer shrink-0 transition-all text-t-primary',
          isMobile && 'sider-action-btn-mobile',
          isActive ? '!bg-primary-1 !text-primary-6' : 'hover:bg-fill-2 active:bg-fill-3'
        )}
        onClick={onClick}
      >
        <span className='size-22px flex items-center justify-center shrink-0'>
          <Broadcast
            theme='outline'
            size='16'
            fill='currentColor'
            className='block leading-none'
            style={{ lineHeight: 0 }}
          />
        </span>
        <span className='collapsed-hidden text-14px font-[500] leading-24px'>{label}</span>
      </div>
    </Tooltip>
  );
};

export default SiderSocialMatrixEntry;
