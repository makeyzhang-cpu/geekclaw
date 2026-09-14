/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// TeamHero —— 「与 X 一起工作」会话栏。
//
// 数字员工 / B2B外贸运营工作台 / B2B外贸业务工作台 三个页面共用同一个发起会话
// 的界面，布局按设计稿还原：
//
//   与 {name} 一起工作   ●●●●●
//   ┌─────────────────────────────────────┐
//   │ 输入您的问题…                         │
//   │ [+] [模型]          ✦优化提示词  (↑)  │
//   └─────────────────────────────────────┘
//   ┌──────────┐ ┌──────────┐ ┌──────────┐
//   │ Lumi  [像]│ │ Lina  [像]│ │ Aria  [像]│
//   │ 网站应用开发│ │ Word专家  │ │ PPT专家  │
//   └──────────┘ └──────────┘ └──────────┘
//
// 硬约束：本组件的每一次点击都必须是**页内行为** —— 成员卡片切到该成员的会话、
// 发送就地落在当前页面内嵌的对话上。任何情况下都不允许跳转到 /conversation
// 功能栏（切换与发送全部由调用方在自己的页面里完成）。

import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, MagicWand, Plus } from '@icon-park/react';
import classNames from 'classnames';

/** 团队成员卡片：左半姓名 + 职位，右半立绘（不足则由 avatar 兜底）。 */
export interface TeamHeroMember {
  id: string;
  /** 主标题（员工名 / 专家名）。 */
  name: string;
  /** 副标题（职位 / 分类 / 等级）。 */
  subtitle?: string;
  /** 右侧立绘（写实人物图）。缺省时回落到 `avatar`。 */
  figureSrc?: string;
  /** 无立绘时的兜底头像节点（如数字员工的角色形象）。 */
  avatar?: React.ReactNode;
  /** 是否为当前正在对话的成员。 */
  active?: boolean;
}

/** 输入框上方一行的快捷入口。 */
export interface TeamHeroChip {
  key: string;
  label: string;
  active?: boolean;
  onClick: () => void;
}

interface TeamHeroProps {
  /** 「与 {title} 一起工作」里的 title（员工名 / 专家名 / 团队名）。 */
  title: string;
  /** 标题右侧叠放的小圆头像。 */
  headAvatars?: React.ReactNode[];
  /** 成员卡片列表。 */
  members: TeamHeroMember[];
  /** 点成员卡片 —— 调用方在**本页内**切到该成员（不得跳转会话页）。 */
  onSelectMember: (id: string) => void;
  /** 卡片区上方的小标题；缺省不显示。 */
  membersTitle?: string;
  chips?: TeamHeroChip[];
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  sending?: boolean;
  placeholder: string;
  /** 输入框左下角的模型 / 工具控件。 */
  modelSlot?: React.ReactNode;
  /** 输入框上方的提示条（如「请先为该员工配置对话模型」）。 */
  banner?: React.ReactNode;
  /** 输入框下方的说明行（如「在项目中工作」）。 */
  footer?: React.ReactNode;
  /** 输入框左下角「+」的行为；缺省不渲染该按钮。 */
  onPlus?: () => void;
}

/**
 * 提示词本地润色（纯前端、可逆）。
 *
 * 把随口一句包装成带「输出要求」的结构化提示；再点一次由调用方还原原文。
 * 智能改写（走模型）留待后续 —— 这里刻意不依赖网络，避免点一下按钮就要起会话。
 */
const polishPrompt = (raw: string, lead: string, tail: string): string => {
  const text = raw.trim();
  if (!text) return raw;
  // 已经套过壳就不再叠加，避免连点两下堆成三层。
  if (text.includes(tail)) return raw;
  return `${lead}\n${text}\n\n${tail}`;
};

const TeamHero: React.FC<TeamHeroProps> = ({
  title,
  headAvatars,
  members,
  onSelectMember,
  membersTitle,
  chips = [],
  input,
  onInputChange,
  onSend,
  sending = false,
  placeholder,
  modelSlot,
  banner,
  footer,
  onPlus,
}) => {
  const { t } = useTranslation();
  /** 润色前的原文；非 null 表示当前输入是润色结果，「还原」用它回退。 */
  const polishedFrom = useRef<string | null>(null);
  const [polished, setPolished] = useState(false);

  const handlePolish = useCallback(() => {
    if (polished) {
      if (polishedFrom.current != null) onInputChange(polishedFrom.current);
      polishedFrom.current = null;
      setPolished(false);
      return;
    }
    if (!input.trim()) return;
    polishedFrom.current = input;
    onInputChange(
      polishPrompt(
        input,
        t('common.teamHero.polishLead', {
          defaultValue: '请针对以下任务给出专业、可执行的答复：',
        }),
        t('common.teamHero.polishTail', {
          defaultValue: '输出要求：结论先行；必要时分点说明，并给出可直接落地的示例。',
        })
      )
    );
    setPolished(true);
  }, [input, onInputChange, polished, t]);

  // 用户手改输入后，润色标记失效（否则「还原」会把手工编辑一并抹掉）。
  const handleInputChange = useCallback(
    (value: string) => {
      if (polished) {
        polishedFrom.current = null;
        setPolished(false);
      }
      onInputChange(value);
    },
    [onInputChange, polished]
  );

  const canSend = !sending && input.trim().length > 0;

  return (
    <div className='flex-1 min-h-0 overflow-y-auto'>
      <div className='mx-auto w-full max-w-980px box-border flex flex-col gap-16px px-24px pt-28px pb-40px'>
        {/* 标题 + 头像组 */}
        <div className='flex items-center gap-14px flex-wrap'>
          <h1 className='m-0 text-28px leading-38px font-700 text-t-primary'>
            {t('common.teamHero.workTogetherWith', {
              name: title,
              defaultValue: '与 {{name}} 一起工作',
            })}
          </h1>
          {headAvatars && headAvatars.length > 0 && (
            <div className='flex items-center shrink-0'>
              {headAvatars.slice(0, 7).map((node, index) => (
                <span
                  key={index}
                  className={classNames(
                    'inline-flex rd-full overflow-hidden shrink-0 ring-2 ring-[var(--color-bg-1)]',
                    index > 0 && '-ml-9px'
                  )}
                >
                  {node}
                </span>
              ))}
            </div>
          )}
        </div>

        {banner}

        {/* 输入卡片 */}
        <div className='w-full rd-20px bg-[var(--color-bg-2)] border border-[var(--color-border-2)] shadow-[0_10px_30px_rgba(0,0,0,0.07)] box-border overflow-hidden'>
          {chips.length > 0 && (
            <div className='flex items-center gap-6px flex-wrap px-14px pt-12px'>
              {chips.map((chip) => (
                <div
                  key={chip.key}
                  role='button'
                  tabIndex={0}
                  onClick={chip.onClick}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      chip.onClick();
                    }
                  }}
                  className={classNames(
                    'flex items-center gap-4px h-26px rd-full px-10px cursor-pointer text-12px transition-colors outline-none',
                    chip.active
                      ? 'font-600 text-primary-6 bg-[rgba(var(--primary-6),0.10)]'
                      : 'text-t-secondary hover:bg-fill-2 hover:text-t-primary'
                  )}
                >
                  {chip.label}
                </div>
              ))}
            </div>
          )}

          <textarea
            value={input}
            onChange={(event) => handleInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (canSend) onSend();
              }
            }}
            placeholder={placeholder}
            className='w-full box-border min-h-72px max-h-200px resize-none bg-transparent border-0 outline-none px-16px pt-14px pb-4px text-14px leading-22px text-t-primary placeholder:text-[var(--color-text-3)]'
            rows={2}
          />

          <div className='flex items-center gap-8px px-12px pb-12px'>
            {onPlus && (
              <div
                role='button'
                tabIndex={0}
                aria-label={t('common.teamHero.more', { defaultValue: '更多' })}
                onClick={onPlus}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onPlus();
                  }
                }}
                className='flex items-center justify-center size-28px rd-8px cursor-pointer text-t-tertiary hover:text-t-primary hover:bg-fill-2 transition-colors outline-none'
              >
                <Plus theme='outline' size='15' fill='currentColor' strokeWidth={3} />
              </div>
            )}
            {modelSlot && <div className='min-w-0'>{modelSlot}</div>}
            <div className='flex-1' />
            <div
              role='button'
              tabIndex={0}
              aria-label={t('common.teamHero.polish', { defaultValue: '优化提示词' })}
              onClick={handlePolish}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handlePolish();
                }
              }}
              className={classNames(
                'flex items-center gap-5px h-30px rd-full px-10px text-12px transition-colors outline-none shrink-0',
                polished
                  ? 'text-primary-6 bg-[rgba(var(--primary-6),0.10)] cursor-pointer'
                  : input.trim()
                    ? 'text-t-secondary hover:text-t-primary hover:bg-fill-2 cursor-pointer'
                    : 'text-t-quaternary opacity-60 cursor-default'
              )}
            >
              <MagicWand theme='outline' size='14' fill='currentColor' strokeWidth={3} />
              <span>
                {polished
                  ? t('common.teamHero.polishUndo', { defaultValue: '还原' })
                  : t('common.teamHero.polish', { defaultValue: '优化提示词' })}
              </span>
            </div>
            <div
              role='button'
              tabIndex={0}
              aria-label={t('common.teamHero.send', { defaultValue: '发送' })}
              onClick={() => {
                if (canSend) onSend();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if (canSend) onSend();
                }
              }}
              className={classNames(
                'flex items-center justify-center size-30px rd-full shrink-0 transition-colors outline-none',
                canSend
                  ? 'cursor-pointer text-[var(--color-bg-1)] bg-primary-6 hover:bg-primary-5'
                  : 'text-t-quaternary bg-fill-2 cursor-not-allowed'
              )}
            >
              <ArrowUp theme='outline' size='15' fill='currentColor' strokeWidth={4} />
            </div>
          </div>
        </div>

        {footer}

        {/* 成员卡片 */}
        {members.length > 0 && (
          <div className='flex flex-col gap-10px'>
            {membersTitle && (
              <span className='px-2px text-12px leading-18px text-t-tertiary'>{membersTitle}</span>
            )}
            <div className='flex flex-wrap gap-12px'>
              {members.map((member) => (
                <div
                  key={member.id}
                  role='button'
                  tabIndex={0}
                  aria-label={member.name}
                  onClick={() => onSelectMember(member.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectMember(member.id);
                    }
                  }}
                  className={classNames(
                    'group relative flex items-center gap-8px w-200px h-86px rd-16px box-border px-14px overflow-hidden cursor-pointer outline-none transition-all border',
                    member.active
                      ? 'border-primary-6 bg-[rgba(var(--primary-6),0.06)] shadow-[0_6px_18px_rgba(0,0,0,0.08)]'
                      : 'border-[var(--color-border-2)] bg-[var(--color-bg-2)] hover:border-primary-5 hover:shadow-[0_6px_18px_rgba(0,0,0,0.08)]'
                  )}
                >
                  <span className='flex flex-col min-w-0 flex-1'>
                    <span className='text-15px leading-22px font-700 text-t-primary truncate'>
                      {member.name}
                    </span>
                    {member.subtitle && (
                      <span className='text-12px leading-18px text-t-tertiary truncate'>
                        {member.subtitle}
                      </span>
                    )}
                  </span>
                  <span className='shrink-0 size-60px flex items-end justify-center overflow-hidden rd-14px bg-fill-1'>
                    {member.figureSrc ? (
                      <img
                        src={member.figureSrc}
                        alt=''
                        draggable={false}
                        className='w-60px h-60px object-cover object-top'
                      />
                    ) : (
                      member.avatar
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TeamHero;
