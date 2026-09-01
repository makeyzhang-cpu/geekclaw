/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tabs, Input, Select, Button, Modal, Message } from '@arco-design/web-react';
import React, { ChangeEventHandler, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import {
  Balance,
  Brain,
  Bug,
  Calendar,
  Camera,
  ChartLine,
  CloudStorage,
  Code,
  Currency,
  Dashboard,
  Delete,
  Download,
  Edit,
  FileText,
  Globe,
  Heart,
  HighLight,
  Histogram,
  International,
  Link,
  Mail,
  Message as MessageIcon,
  People,
  Pie,
  Plus,
  Report,
  Scan,
  Search,
  Setting,
  Speaker,
  Text,
  Trend,
  Translate,
  Upload,
  Video,
} from '@icon-park/react';
import HubPageShell from '@renderer/components/layout/HubPageShell';
import NomiModal from '@renderer/components/base/NomiModal';
import {
  ExpertIdentity,
  ExpertSkill,
  CollaborationFeature,
  collabFeatures,
  groupByIdentityCategory,
  groupBySkillCategory,
} from './data';
import { useExpertIdentities } from './useExpertIdentities';
import { useExpertSkills } from './useExpertSkills';
import { useExpertConversationLauncher } from './useExpertConversationLauncher';

type IconComp = React.ComponentType<{
  size?: number | string;
  theme?: 'outline' | 'filled' | 'two-tone' | 'multi-color';
  fill?: string;
  className?: string;
  style?: React.CSSProperties;
}>;

const iconMap: Record<string, IconComp> = {
  Balance,
  Brain,
  Bug,
  Calendar,
  Camera,
  ChartLine,
  CloudStorage,
  Code,
  Currency,
  Dashboard,
  Edit,
  FileText,
  Globe,
  Heart,
  HighLight,
  Histogram,
  International,
  Link,
  Mail,
  People,
  Pie,
  Report,
  Scan,
  Search,
  Setting,
  Speaker,
  Text,
  Trend,
  Translate,
  Video,
};

const resolveIcon = (name: string): IconComp => iconMap[name] ?? People;

const iconOptions = Object.keys(iconMap).map((key) => ({ label: key, value: key }));

/** 协同办公「协作动态」示例（演示用静态流，营造多专家协作群聊观感） */
const collabFeed: Array<{ icon: string; name: string; text: string }> = [
  { icon: 'Mail', name: '外贸业务员', text: '调用「开发信撰写」生成 3 封英文开发信，已按 SILVER 客户排期发送。' },
  { icon: 'Balance', name: '关务合规专家', text: '完成 HS 编码归类，建议 9405.40，退税参考 13%。' },
  { icon: 'Currency', name: '国际支付结算', text: '比对 TT / 信用证 / PingPong，推荐本案用 PingPong 收款。' },
  { icon: 'Globe', name: '跨境电商运营', text: 'Listing 标题已优化，搜索曝光预计 +18%。' },
  { icon: 'CloudStorage', name: '知识库调用', text: '检索到 2 份客户背调 SOP 已注入当前工作流上下文。' },
];

interface IdentityCardProps {
  item: ExpertIdentity;
  findSkill: (id: string) => ExpertSkill | undefined;
  onEdit: (item: ExpertIdentity) => void;
  onDelete: (item: ExpertIdentity) => void;
  onLaunch: (item: ExpertIdentity) => void;
}

const IdentityCard: React.FC<IdentityCardProps> = ({ item, findSkill, onEdit, onDelete, onLaunch }) => {
  const Icon = resolveIcon(item.icon);
  const skills = item.skillIds.map(findSkill).filter((s): s is ExpertSkill => Boolean(s));
  return (
    <div className='group relative flex flex-col gap-10px p-16px rd-12px border border-solid border-[var(--color-border-2)] bg-fill-1 hover:border-primary-6 hover:shadow-sm transition-all'>
      <div className='flex items-center gap-10px pr-60px'>
        <span className='size-40px rounded-full bg-primary-1 text-primary-6 flex items-center justify-center shrink-0'>
          <Icon size={22} theme='outline' fill='currentColor' />
        </span>
        <span className='text-15px font-600 text-t-primary leading-20px'>{item.name}</span>
      </div>
      <p className='text-13px leading-18px text-t-tertiary m-0'>{item.description}</p>
      {skills.length > 0 && (
        <div className='flex flex-wrap gap-6px mt-2px'>
          {skills.map((s) => (
            <span
              key={s.id}
              className='px-8px py-2px rd-6px bg-fill-2 text-12px text-t-secondary leading-16px'
            >
              {s.name}
            </span>
          ))}
        </div>
      )}
      <div className='absolute top-10px right-10px hidden group-hover:flex gap-6px'>
        <Button
          type='text'
          size='mini'
          icon={<MessageIcon size={15} />}
          onClick={(e) => {
            e.stopPropagation();
            onLaunch(item);
          }}
          aria-label='发起对话'
        />
        <Button
          type='text'
          size='mini'
          icon={<Edit size={15} />}
          onClick={(e) => {
            e.stopPropagation();
            onEdit(item);
          }}
          aria-label='编辑'
        />
        <Button
          type='text'
          size='mini'
          status='danger'
          icon={<Delete size={15} />}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item);
          }}
          aria-label='删除'
        />
      </div>
    </div>
  );
};

interface SkillCardProps {
  item: ExpertSkill;
  onEdit: (item: ExpertSkill) => void;
  onDelete: (item: ExpertSkill) => void;
  onLaunchSkill: (item: ExpertSkill) => void;
}

const SkillCard: React.FC<SkillCardProps> = ({ item, onEdit, onDelete, onLaunchSkill }) => {
  const Icon = resolveIcon(item.icon);
  return (
    <div className='group relative flex flex-col gap-10px p-16px rd-12px border border-solid border-[var(--color-border-2)] bg-fill-1 hover:border-primary-6 hover:shadow-sm transition-all'>
      <div className='flex items-center gap-10px pr-60px'>
        <span className='size-40px rounded-full bg-primary-1 text-primary-6 flex items-center justify-center shrink-0'>
          <Icon size={22} theme='outline' fill='currentColor' />
        </span>
        <span className='text-15px font-600 text-t-primary leading-20px'>{item.name}</span>
      </div>
      <p className='text-13px leading-18px text-t-tertiary m-0'>{item.description}</p>
      {item.definition && (
        <p className='text-12px leading-16px text-t-quaternary m-0 line-clamp-2'>
          {item.definition.slice(0, 80)}
          {item.definition.length > 80 ? '…' : ''}
        </p>
      )}
      <div className='absolute top-10px right-10px hidden group-hover:flex gap-6px'>
        <Button
          type='text'
          size='mini'
          icon={<MessageIcon size={15} />}
          onClick={(e) => {
            e.stopPropagation();
            onLaunchSkill(item);
          }}
          aria-label='用此技能发起对话'
        />
        <Button
          type='text'
          size='mini'
          icon={<Edit size={15} />}
          onClick={(e) => {
            e.stopPropagation();
            onEdit(item);
          }}
          aria-label='编辑'
        />
        <Button
          type='text'
          size='mini'
          status='danger'
          icon={<Delete size={15} />}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item);
          }}
          aria-label='删除'
        />
      </div>
    </div>
  );
};

/** 协同办公：左侧办公群成员行 */
const CollabMemberRow: React.FC<{ item: ExpertIdentity; onLaunch: (item: ExpertIdentity) => void }> = ({
  item,
  onLaunch,
}) => {
  const Icon = resolveIcon(item.icon);
  return (
    <div className='flex items-center gap-10px px-12px py-10px rd-10px hover:bg-fill-2 transition-colors'>
      <span className='size-36px rounded-full bg-primary-1 text-primary-6 flex items-center justify-center shrink-0'>
        <Icon size={18} theme='outline' fill='currentColor' />
      </span>
      <div className='flex-1 min-w-0'>
        <div className='text-14px font-medium text-t-primary leading-18px truncate'>{item.name}</div>
        <div className='text-12px text-t-quaternary leading-16px truncate'>{item.category}</div>
      </div>
      <span className='px-8px py-1px rd-6px bg-fill-2 text-12px text-t-tertiary shrink-0'>
        {item.skillIds.length} 技能
      </span>
      <Button
        type='text'
        size='mini'
        icon={<MessageIcon size={15} />}
        onClick={(e) => {
          e.stopPropagation();
          onLaunch(item);
        }}
        aria-label='发起对话'
      />
    </div>
  );
};

/** 协同办公：右侧协作动态消息（群聊观感） */
const CollabFeedItem: React.FC<{ icon: string; name: string; text: string }> = ({
  icon,
  name,
  text,
}) => {
  const Icon = resolveIcon(icon);
  return (
    <div className='flex gap-10px px-12px py-8px'>
      <span className='size-30px rounded-full bg-primary-1 text-primary-6 flex items-center justify-center shrink-0 mt-2px'>
        <Icon size={15} theme='outline' fill='currentColor' />
      </span>
      <div className='flex-1 bg-fill-2 rd-10px px-12px py-8px'>
        <span className='text-12px font-medium text-t-secondary'>{name}</span>
        <p className='text-13px leading-18px text-t-primary m-0 mt-2px'>{text}</p>
      </div>
    </div>
  );
};

/** 把选中的协同能力 id 组合成「深度闭环」系统提示词增强段。 */
function buildCapabilityDirective(ids: string[]): string {
  if (!ids.length) return '';
  const blocks = ids
    .map((id) => {
      const item = collabFeatures.find((f) => f.id === id);
      const bullets = collabDetailMap[id] ?? [];
      if (!item) return '';
      return `【${item.name}】\n${bullets.map((b) => `- ${b}`).join('\n')}`;
    })
    .filter(Boolean);
  if (!blocks.length) return '';
  return `本次对话启用以下协同能力，请在执行任务时主动运用并形成闭环：\n${blocks.join('\n')}`;
}

/** 协同办公：能力选择弹窗（多选，每个能力带「+」可叠加，组合为深度闭环调用） */
const CollabDeepLoopPicker: React.FC<{
  visible: boolean;
  features: CollaborationFeature[];
  selected: string[];
  onToggle: (id: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ visible, features, selected, onToggle, onConfirm, onCancel }) => {
  const isSel = (id: string) => selected.includes(id);
  return (
    <NomiModal
      visible={visible}
      size='large'
      header='选择协同能力 · 深度闭环调用'
      onCancel={onCancel}
      footer={
        <div className='flex items-center justify-between mt-12px'>
          <span className='text-13px text-t-tertiary'>
            已选 {selected.length} 项 · 可叠加多个能力组合调用
          </span>
          <div className='flex gap-10px'>
            <Button onClick={onCancel} className='px-20px min-w-80px' style={{ borderRadius: 8 }}>
              取消
            </Button>
            <Button
              type='primary'
              disabled={selected.length === 0}
              onClick={onConfirm}
              className='px-20px min-w-140px'
              style={{ borderRadius: 8 }}
            >
              发起深度闭环调用
            </Button>
          </div>
        </div>
      }
    >
      <div className='flex flex-col gap-8px py-8px'>
        {features.map((item) => {
          const Icon = resolveIcon(item.icon);
          const sel = isSel(item.id);
          return (
            <div
              key={item.id}
              role='button'
              tabIndex={0}
              onClick={() => onToggle(item.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onToggle(item.id);
                }
              }}
              className={classNames(
                'flex items-center gap-12px px-12px py-12px rd-10px border border-solid transition-all',
                sel
                  ? 'border-primary-6 bg-primary-1 shadow-sm'
                  : 'border-[var(--color-border-2)] bg-fill-1 hover:border-primary-6 hover:shadow-sm hover:cursor-pointer'
              )}
            >
              <span
                className={classNames(
                  'size-40px rounded-full flex items-center justify-center shrink-0',
                  sel ? 'bg-primary-6 text-white' : 'bg-primary-1 text-primary-6'
                )}
              >
                <Icon size={20} theme='outline' fill='currentColor' />
              </span>
              <div className='flex-1 min-w-0'>
                <div className='text-14px font-600 text-t-primary leading-20px'>{item.name}</div>
                <p className='text-13px leading-18px text-t-tertiary m-0 mt-4px'>{item.description}</p>
              </div>
              <span
                className={classNames(
                  'shrink-0 size-26px rounded-full flex items-center justify-center text-16px font-700 transition-colors select-none',
                  sel
                    ? 'bg-primary-6 text-white'
                    : 'border border-solid border-[var(--color-border-3)] text-t-quaternary'
                )}
                aria-hidden
              >
                {sel ? '✓' : '+'}
              </span>
            </div>
          );
        })}
      </div>
    </NomiModal>
  );
};

/** 协同能力详情：按 id 给出能力说明 */
const collabDetailMap: Record<string, string[]> = {
  'multi-expert': [
    '从「专家身份」库中选择任意专家分身加入协同',
    '按各身份绑定的专属技能自动编排子任务',
    '多专家结果汇总为统一交付物，避免信息割裂',
  ],
  'kb-call': [
    '检索企业 / 个人知识库中的文档、话术与 SOP',
    '将相关片段注入专家上下文，提升作答可信度',
    '支持按主题 / 标签过滤，并标注来源文档',
  ],
  'long-memory': [
    '跨会话保留用户偏好、客户与项目背景',
    '自动沉淀长效记忆，越用越懂你',
    '专家可读取历史决策上下文，保持连贯',
  ],
  'store-memory': [
    '主动将关键结论与资料保存到记忆库',
    '按专家 / 主题归档，结构清晰',
    '随时检索复用，沉淀团队资产',
  ],
  'local-space': [
    '在本地文件空间集中管理文档、素材与产出物',
    '可导入素材、导出成果，数据自主可控',
    '与本地知识库联动，离线可用',
  ],
};

interface IdentityEditorState {
  open: boolean;
  mode: 'create' | 'edit';
  draft: ExpertIdentity;
}

interface SkillEditorState {
  open: boolean;
  mode: 'create' | 'edit';
  draft: ExpertSkill;
}

interface BaseEditorModalProps<T> {
  visible: boolean;
  mode: 'create' | 'edit';
  draft: T;
  categories: string[];
  onCancel: () => void;
  onSave: (item: T) => void;
}

interface IdentityEditorModalProps extends BaseEditorModalProps<ExpertIdentity> {
  skills: ExpertSkill[];
}

const IdentityEditorModal: React.FC<IdentityEditorModalProps> = ({
  visible,
  mode,
  draft,
  categories,
  skills,
  onCancel,
  onSave,
}) => {
  const [name, setName] = useState(draft.name);
  const [category, setCategory] = useState(draft.category);
  const [description, setDescription] = useState(draft.description);
  const [icon, setIcon] = useState(draft.icon);
  const [skillIds, setSkillIds] = useState<string[]>(draft.skillIds);

  useEffect(() => {
    if (!visible) return;
    setName(draft.name);
    setCategory(draft.category);
    setDescription(draft.description);
    setIcon(draft.icon);
    setSkillIds(draft.skillIds);
  }, [visible, draft]);

  const skillOptions = useMemo(
    () => skills.map((s) => ({ label: `${s.name}（${s.category}）`, value: s.id })),
    [skills]
  );

  const PreviewIcon = resolveIcon(icon);

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Message.error('请填写专家身份名称');
      return;
    }
    onSave({
      id: draft.id,
      name: trimmedName,
      category: category.trim() || '未分类',
      description: description.trim(),
      icon: icon || 'People',
      skillIds,
    });
  };

  return (
    <NomiModal
      visible={visible}
      size='large'
      header={mode === 'create' ? '新建专家身份' : '编辑专家身份'}
      onCancel={onCancel}
      footer={
        <div className='flex justify-end gap-10px mt-12px'>
          <Button onClick={onCancel} className='px-20px min-w-80px' style={{ borderRadius: 8 }}>
            取消
          </Button>
          <Button
            type='primary'
            onClick={handleSave}
            className='px-20px min-w-80px'
            style={{ borderRadius: 8 }}
          >
            保存
          </Button>
        </div>
      }
    >
      <div className='flex flex-col gap-16px py-8px'>
        <div className='flex items-start gap-16px'>
          <div className='flex flex-col gap-6px w-120px shrink-0'>
            <span className='text-13px text-t-secondary'>图标</span>
            <span className='size-48px rounded-10px bg-primary-1 text-primary-6 flex items-center justify-center'>
              <PreviewIcon size={24} theme='outline' fill='currentColor' />
            </span>
          </div>
          <div className='flex-1'>
            <Select
              value={icon}
              onChange={setIcon}
              options={iconOptions}
              showSearch
              placeholder='选择图标'
              className='w-full'
            />
          </div>
        </div>

        <div className='flex flex-col gap-6px'>
          <span className='text-13px text-t-secondary'>身份名称</span>
          <Input
            value={name}
            onChange={setName}
            placeholder='如：外贸业务员 / 海外社媒引流'
            maxLength={40}
            allowClear
          />
        </div>

        <div className='flex flex-col gap-6px'>
          <span className='text-13px text-t-secondary'>分类</span>
          <Select
            showSearch
            allowCreate
            value={category}
            onChange={setCategory}
            options={categories.map((c) => ({ label: c, value: c }))}
            placeholder='选择或输入分类，如：外贸拓客'
            className='w-full'
          />
        </div>

        <div className='flex flex-col gap-6px'>
          <span className='text-13px text-t-secondary'>身份描述</span>
          <Input.TextArea
            value={description}
            onChange={setDescription}
            placeholder='一句话描述该专家身份的职责与价值'
            autoSize={{ minRows: 2, maxRows: 4 }}
            maxLength={120}
            showWordLimit
          />
        </div>

        <div className='flex flex-col gap-6px'>
          <span className='text-13px text-t-secondary'>
            关联专长技能（每个身份独一无二的技能组合）
          </span>
          <Select
            mode='multiple'
            value={skillIds}
            onChange={setSkillIds}
            options={skillOptions}
            placeholder='从技能库中为该身份绑定专属技能'
            className='w-full'
            maxTagCount={6}
          />
          <span className='text-12px text-t-quaternary'>已选 {skillIds.length} 项技能</span>
        </div>
      </div>
    </NomiModal>
  );
};

const SkillEditorModal: React.FC<BaseEditorModalProps<ExpertSkill>> = ({
  visible,
  mode,
  draft,
  categories,
  onCancel,
  onSave,
}) => {
  const [name, setName] = useState(draft.name);
  const [category, setCategory] = useState(draft.category);
  const [description, setDescription] = useState(draft.description);
  const [icon, setIcon] = useState(draft.icon);
  const [definition, setDefinition] = useState(draft.definition ?? '');

  useEffect(() => {
    if (!visible) return;
    setName(draft.name);
    setCategory(draft.category);
    setDescription(draft.description);
    setIcon(draft.icon);
    setDefinition(draft.definition ?? '');
  }, [visible, draft]);

  const PreviewIcon = resolveIcon(icon);

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Message.error('请填写技能名称');
      return;
    }
    onSave({
      id: draft.id,
      name: trimmedName,
      category: category.trim() || '未分类',
      description: description.trim(),
      icon: icon || 'People',
      definition: definition.trim(),
    });
  };

  return (
    <NomiModal
      visible={visible}
      size='large'
      header={mode === 'create' ? '新建专家技能' : '编辑专家技能'}
      onCancel={onCancel}
      footer={
        <div className='flex justify-end gap-10px mt-12px'>
          <Button onClick={onCancel} className='px-20px min-w-80px' style={{ borderRadius: 8 }}>
            取消
          </Button>
          <Button
            type='primary'
            onClick={handleSave}
            className='px-20px min-w-80px'
            style={{ borderRadius: 8 }}
          >
            保存
          </Button>
        </div>
      }
    >
      <div className='flex flex-col gap-16px py-8px'>
        <div className='flex items-start gap-16px'>
          <div className='flex flex-col gap-6px w-120px shrink-0'>
            <span className='text-13px text-t-secondary'>图标</span>
            <span className='size-48px rounded-10px bg-primary-1 text-primary-6 flex items-center justify-center'>
              <PreviewIcon size={24} theme='outline' fill='currentColor' />
            </span>
          </div>
          <div className='flex-1'>
            <Select
              value={icon}
              onChange={setIcon}
              options={iconOptions}
              showSearch
              placeholder='选择图标'
              className='w-full'
            />
          </div>
        </div>

        <div className='flex flex-col gap-6px'>
          <span className='text-13px text-t-secondary'>技能名称</span>
          <Input
            value={name}
            onChange={setName}
            placeholder='如：开发信撰写 / 海关编码'
            maxLength={40}
            allowClear
          />
        </div>

        <div className='flex flex-col gap-6px'>
          <span className='text-13px text-t-secondary'>分类</span>
          <Select
            showSearch
            allowCreate
            value={category}
            onChange={setCategory}
            options={categories.map((c) => ({ label: c, value: c }))}
            placeholder='选择或输入分类，如：客户开发'
            className='w-full'
          />
        </div>

        <div className='flex flex-col gap-6px'>
          <span className='text-13px text-t-secondary'>一句话描述</span>
          <Input.TextArea
            value={description}
            onChange={setDescription}
            placeholder='简短说明该技能能解决什么问题'
            autoSize={{ minRows: 2, maxRows: 3 }}
            maxLength={80}
            showWordLimit
          />
        </div>

        <div className='flex flex-col gap-6px'>
          <span className='text-13px text-t-secondary'>技能定义（提示词 / 执行指令 / 工具说明）</span>
          <Input.TextArea
            value={definition}
            onChange={setDefinition}
            placeholder='输入该技能的系统提示词、工作流或工具调用说明。可被导入导出，供专家身份调用时执行。'
            autoSize={{ minRows: 5, maxRows: 10 }}
            maxLength={2000}
            showWordLimit
          />
        </div>
      </div>
    </NomiModal>
  );
};

/** 协同办公：多专家协同选择弹窗（勾选成员后真实发起多专家对话） */
const CollabMultiExpertModal: React.FC<{
  visible: boolean;
  identities: ExpertIdentity[];
  selected: string[];
  onChange: (ids: string[]) => void;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ visible, identities, selected, onChange, onCancel, onConfirm }) => {
  const toggle = (id: string, checked: boolean) => {
    if (checked) onChange([...selected, id]);
    else onChange(selected.filter((x) => x !== id));
  };
  return (
    <NomiModal
      visible={visible}
      size='large'
      header='选择协同专家'
      onCancel={onCancel}
      footer={
        <div className='flex justify-end mt-12px gap-10px'>
          <Button onClick={onCancel} className='px-20px min-w-80px' style={{ borderRadius: 8 }}>
            取消
          </Button>
          <Button
            type='primary'
            onClick={onConfirm}
            className='px-20px min-w-80px'
            style={{ borderRadius: 8 }}
            disabled={selected.length === 0}
          >
            发起协同对话
          </Button>
        </div>
      }
    >
      <p className='text-13px text-t-tertiary m-0 mb-10px'>
        勾选要加入本次协同工作流的外贸专家，系统将按各专家专长分工协作完成复杂任务。
      </p>
      <div className='flex flex-col gap-8px' style={{ maxHeight: 360, overflowY: 'auto' }}>
        {identities.map((it) => {
          const I = resolveIcon(it.icon);
          const checked = selected.includes(it.id);
          return (
            <label
              key={it.id}
              className='flex items-center gap-10px px-12px py-10px rd-10px border border-solid border-[var(--color-border-2)] hover:bg-fill-2 cursor-pointer'
            >
              <input
                type='checkbox'
                checked={checked}
                onChange={(e) => toggle(it.id, e.target.checked)}
              />
              <span className='size-30px rounded-full bg-primary-1 text-primary-6 flex items-center justify-center shrink-0'>
                <I size={15} theme='outline' fill='currentColor' />
              </span>
              <span className='flex-1 text-13px text-t-primary'>{it.name}</span>
              <span className='text-12px text-t-quaternary'>{it.category}</span>
            </label>
          );
        })}
        {identities.length === 0 && (
          <p className='text-12px text-t-quaternary px-12px py-8px'>暂无专家，请先在「专家身份」中新增。</p>
        )}
      </div>
    </NomiModal>
  );
};

/** 协同能力详情弹窗 */
type ExpertTab = 'identity' | 'skill' | 'collab';

const emptyIdentityDraft = (id: string): ExpertIdentity => ({
  id,
  name: '',
  category: '',
  description: '',
  icon: 'People',
  skillIds: [],
});

const emptySkillDraft = (id: string): ExpertSkill => ({
  id,
  name: '',
  category: '',
  description: '',
  icon: 'People',
  definition: '',
});

const ExpertAgentsPage: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ExpertTab>('identity');
  const {
    identities,
    upsertIdentity,
    removeIdentity,
    createId: createIdentityId,
  } = useExpertIdentities();
  const {
    skills,
    upsertSkill,
    removeSkill,
    importSkills,
    exportSkills,
    createId: createSkillId,
    findSkill,
  } = useExpertSkills();
  const [identityEditor, setIdentityEditor] = useState<IdentityEditorState>({
    open: false,
    mode: 'edit',
    draft: emptyIdentityDraft(''),
  });
  const [skillEditor, setSkillEditor] = useState<SkillEditorState>({
    open: false,
    mode: 'edit',
    draft: emptySkillDraft(''),
  });
  const [multiExpertOpen, setMultiExpertOpen] = useState(false);
  const [multiSelected, setMultiSelected] = useState<string[]>([]);
  const [capabilityPickerOpen, setCapabilityPickerOpen] = useState(false);
  const [selectedCaps, setSelectedCaps] = useState<string[]>([]);
  const deepLoopDirectiveRef = useRef<string>('');
  const skillFileRef = useRef<HTMLInputElement>(null);

  const { launch, launchMulti } = useExpertConversationLauncher();

  /** 发起单个专家对话（并持久化该身份对应的 presetId，便于后续编辑即时反映） */
  const handleLaunchIdentity = (item: ExpertIdentity) => {
    const skills = item.skillIds.map(findSkill).filter((s): s is ExpertSkill => Boolean(s));
    launch(item, skills, {
      persistPresetId: (id) => {
        if (id !== item.presetId) upsertIdentity({ ...item, presetId: id });
      },
    });
  };

  /** 用单个技能发起对话（合成一个只带该技能的单专家人格） */
  const handleLaunchSkill = (item: ExpertSkill) => {
    const synthetic: ExpertIdentity = {
      id: `skill-${item.id}`,
      name: item.name,
      category: item.category,
      description: item.description,
      icon: item.icon,
      skillIds: [item.id],
    };
    launch(synthetic, [item], {
      persistPresetId: (id) => {
        if (id !== item.presetId) upsertSkill({ ...item, presetId: id });
      },
    });
  };

  /** 协同能力卡点击：多专家协同 → 打开选择弹窗；其余 → 打开详情弹窗 */
  /** 切换某个协同能力是否加入深度闭环 */
  const handleToggleCap = (id: string) => {
    setSelectedCaps((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  /** 确认发起深度闭环调用：组合多个协同能力（可含多专家） */
  const handleConfirmDeepLoop = () => {
    const caps = selectedCaps;
    if (caps.length === 0) {
      Message.warning('请至少选择一个协同能力');
      return;
    }
    const otherCaps = caps.filter((id) => id !== 'multi-expert');
    const directive = buildCapabilityDirective(otherCaps);
    if (caps.includes('multi-expert')) {
      // 闭环含多专家：先选专家，最终把其余能力注入多专家提示词
      deepLoopDirectiveRef.current = directive;
      setCapabilityPickerOpen(false);
      setMultiSelected(identities.slice(0, Math.min(3, identities.length)).map((i) => i.id));
      setMultiExpertOpen(true);
    } else {
      // 纯能力闭环：以「深度闭环调用」人格发起单对话
      const items = caps
        .map((id) => collabFeatures.find((f) => f.id === id))
        .filter((x): x is CollaborationFeature => Boolean(x));
      const synthetic: ExpertIdentity = {
        id: 'deep-loop',
        name: '深度闭环调用',
        category: '协同办公',
        description: items.map((c) => c.name).join(' · '),
        icon: 'Link',
        skillIds: [],
      };
      setCapabilityPickerOpen(false);
      setSelectedCaps([]);
      launch(synthetic, [], { extraDirective: directive });
    }
  };

  /** 确认发起多专家协同对话（含深度闭环能力增强） */
  const handleLaunchMulti = () => {
    const experts = identities.filter((i) => multiSelected.includes(i.id));
    if (experts.length === 0) {
      Message.error('请至少选择一位专家');
      return;
    }
    const directive = deepLoopDirectiveRef.current;
    deepLoopDirectiveRef.current = '';
    launchMulti(experts, findSkill, directive || undefined);
    setMultiExpertOpen(false);
  };

  const identityGroups = useMemo(() => groupByIdentityCategory(identities), [identities]);
  const skillGroups = useMemo(() => groupBySkillCategory(skills), [skills]);
  const identityCategories = useMemo(
    () => Array.from(new Set(identities.map((i) => i.category))),
    [identities]
  );
  const skillCategories = useMemo(
    () => Array.from(new Set(skills.map((s) => s.category))),
    [skills]
  );

  // Identity editor
  const openIdentityCreate = () =>
    setIdentityEditor({ open: true, mode: 'create', draft: emptyIdentityDraft(createIdentityId()) });
  const openIdentityEdit = (item: ExpertIdentity) =>
    setIdentityEditor({ open: true, mode: 'edit', draft: item });
  const closeIdentityEditor = () => setIdentityEditor((s) => ({ ...s, open: false }));

  const handleIdentitySave = (item: ExpertIdentity) => {
    upsertIdentity(item);
    closeIdentityEditor();
    Message.success(item.name ? `已保存身份「${item.name}」` : '已保存');
  };

  const handleIdentityDelete = (item: ExpertIdentity) => {
    Modal.confirm({
      title: '删除专家身份',
      content: `确定删除「${item.name}」吗？该操作不可撤销。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { status: 'danger' },
      onOk: () => {
        removeIdentity(item.id);
        Message.success(`已删除身份「${item.name}」`);
      },
    });
  };

  // Skill editor
  const openSkillCreate = () =>
    setSkillEditor({ open: true, mode: 'create', draft: emptySkillDraft(createSkillId()) });
  const openSkillEdit = (item: ExpertSkill) =>
    setSkillEditor({ open: true, mode: 'edit', draft: item });
  const closeSkillEditor = () => setSkillEditor((s) => ({ ...s, open: false }));

  const handleSkillSave = (item: ExpertSkill) => {
    upsertSkill(item);
    closeSkillEditor();
    Message.success(item.name ? `已保存技能「${item.name}」` : '已保存');
  };

  const handleSkillDelete = (item: ExpertSkill) => {
    Modal.confirm({
      title: '删除专家技能',
      content: `确定删除「${item.name}」吗？引用该技能的身份将不再显示此技能。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { status: 'danger' },
      onOk: () => {
        removeSkill(item.id);
        Message.success(`已删除技能「${item.name}」`);
      },
    });
  };

  const handleSkillExport = () => {
    const blob = new Blob([exportSkills()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `geekclaw-skills-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    Message.success('技能库已导出');
  };

  const handleSkillImportClick = () => skillFileRef.current?.click();

  const handleSkillFileChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed)) throw new Error('文件内容必须是技能对象数组');
        const count = importSkills(parsed as ExpertSkill[], 'merge');
        Message.success(`成功导入 ${count} 个技能（已按 id 合并）`);
      } catch (err) {
        Message.error(`导入失败：${err instanceof Error ? err.message : '未知错误'}`);
      } finally {
        if (skillFileRef.current) skillFileRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  return (
    <HubPageShell
      title={t('settings.expertAgentsHub.title', { defaultValue: '极客出海Agent' })}
      subtitle={t('settings.expertAgentsHub.subtitle', {
        defaultValue:
          '跨境外贸专家分身智能体，按跨境外贸实战专家身份与技能设置专家智能体，不同跨境外贸的专家身份，每个都具备独一无二的专长技能。',
      })}
    >
      <Tabs
        activeTab={activeTab}
        onChange={(key) => setActiveTab(key as ExpertTab)}
        type='capsule'
        className='mb-8px'
      >
        <Tabs.TabPane
          key='identity'
          title={t('settings.expertAgentsHub.identityTab', { defaultValue: '专家身份' })}
        >
          <div className='flex items-center justify-between gap-12px mb-12px'>
            <p className='text-13px leading-18px text-t-tertiary m-0 flex-1'>
              {t('settings.expertAgentsHub.identityDesc', {
                defaultValue:
                  '不同跨境外贸的专家身份，可编辑与修改，每个身份都具备独一无二的专长技能。',
              })}
            </p>
            <div className='flex items-center gap-8px shrink-0'>
              <Button
                type='primary'
                icon={<Plus size={16} />}
                onClick={openIdentityCreate}
                className='px-14px'
                style={{ borderRadius: 8 }}
              >
                新建专家身份
              </Button>
            </div>
          </div>
          {identityGroups.map((group) => (
            <section key={group.category} className='mb-8px'>
              <h3 className='text-13px font-600 text-t-secondary mt-18px mb-10px'>
                {group.category}
              </h3>
              <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-12px'>
                {group.items.map((item) => (
                  <IdentityCard
                    key={item.id}
                    item={item}
                    findSkill={findSkill}
                    onEdit={openIdentityEdit}
                    onDelete={handleIdentityDelete}
                    onLaunch={handleLaunchIdentity}
                  />
                ))}
              </div>
            </section>
          ))}
        </Tabs.TabPane>

        <Tabs.TabPane
          key='skill'
          title={t('settings.expertAgentsHub.skillTab', { defaultValue: '专家技能' })}
        >
          <div className='flex items-center justify-between gap-12px mb-12px'>
            <p className='text-13px leading-18px text-t-tertiary m-0 flex-1'>
              {t('settings.expertAgentsHub.skillDesc', {
                defaultValue: '可编辑、上传 skills、保存和修改的跨境外贸专家技能库。',
              })}
            </p>
            <div className='flex items-center gap-8px shrink-0'>
              <input
                ref={skillFileRef}
                type='file'
                accept='.json,application/json'
                className='hidden'
                onChange={handleSkillFileChange}
              />
              <Button
                icon={<Upload size={15} />}
                onClick={handleSkillImportClick}
                className='px-14px'
                style={{ borderRadius: 8 }}
              >
                导入技能
              </Button>
              <Button
                icon={<Download size={15} />}
                onClick={handleSkillExport}
                className='px-14px'
                style={{ borderRadius: 8 }}
              >
                导出技能
              </Button>
              <Button
                type='primary'
                icon={<Plus size={16} />}
                onClick={openSkillCreate}
                className='px-14px'
                style={{ borderRadius: 8 }}
              >
                新建专家技能
              </Button>
            </div>
          </div>
          {skillGroups.map((group) => (
            <section key={group.category} className='mb-8px'>
              <h3 className='text-13px font-600 text-t-secondary mt-18px mb-10px'>
                {group.category}
              </h3>
              <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-12px'>
                {group.items.map((item) => (
                  <SkillCard
                    key={item.id}
                    item={item}
                    onEdit={openSkillEdit}
                    onDelete={handleSkillDelete}
                    onLaunchSkill={handleLaunchSkill}
                  />
                ))}
              </div>
            </section>
          ))}
        </Tabs.TabPane>

        <Tabs.TabPane
          key='collab'
          title={t('settings.expertAgentsHub.collabTab', { defaultValue: '协同办公' })}
        >
          <p className='text-13px leading-18px text-t-tertiary m-0 mb-12px'>
            {t('settings.expertAgentsHub.collabDesc', {
              defaultValue:
                '调用不同的专家及专家技能进行协同办公，并支持调用知识库、长效记忆、储存记忆、本地空间等能力。',
            })}
          </p>
          <div className='flex flex-col lg:flex-row gap-12px'>
            {/* 左侧：办公群成员 */}
            <aside className='w-full lg:w-300px shrink-0 border border-solid border-[var(--color-border-2)] rd-12px bg-fill-1 p-12px flex flex-col'>
              <div className='flex items-center justify-between px-12px mb-6px'>
                <span className='text-14px font-600 text-t-primary'>
                  办公群成员
                  <span className='text-12px text-t-quaternary ml-6px'>({identities.length})</span>
                </span>
                <Button
                  type='text'
                  size='mini'
                  icon={<Plus size={14} />}
                  onClick={openIdentityCreate}
                  aria-label='新增成员'
                />
              </div>
              <div className='flex-1 flex flex-col gap-2px' style={{ maxHeight: 460, overflowY: 'auto' }}>
                {identities.map((item) => (
                  <CollabMemberRow key={item.id} item={item} onLaunch={handleLaunchIdentity} />
                ))}
                {identities.length === 0 && (
                  <p className='text-12px text-t-quaternary px-12px py-8px'>
                    暂无成员，点击右上角 + 新增专家身份
                  </p>
                )}
              </div>
            </aside>

            {/* 右侧：协作区 */}
            <section className='flex-1 flex flex-col gap-12px min-w-0'>
              {/* 协作动态 */}
              <div className='border border-solid border-[var(--color-border-2)] rd-12px bg-fill-1 p-12px'>
                <h3 className='text-14px font-600 text-t-primary mt-0 mb-8px px-12px'>协作动态</h3>
                <div className='flex flex-col gap-2px' style={{ maxHeight: 240, overflowY: 'auto' }}>
                  {collabFeed.map((f, i) => (
                    <CollabFeedItem key={i} icon={f.icon} name={f.name} text={f.text} />
                  ))}
                </div>
              </div>
              {/* 协同能力入口：融合为单个「+」触发 */}
              <div className='border border-solid border-[var(--color-border-2)] rd-12px bg-fill-1 p-12px'>
                <div className='flex items-center justify-between px-12px mb-8px'>
                  <h3 className='text-14px font-600 text-t-primary m-0'>协同能力</h3>
                  <Button
                    type='text'
                    size='mini'
                    icon={<Plus size={14} />}
                    onClick={() => { setSelectedCaps([]); setCapabilityPickerOpen(true); }}
                    aria-label='调用协同能力'
                  />
                </div>
                <div className='flex justify-center px-12px'>
                  <div
                    role='button'
                    tabIndex={0}
                    onClick={() => { setSelectedCaps([]); setCapabilityPickerOpen(true); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedCaps([]);
                        setCapabilityPickerOpen(true);
                      }
                    }}
                    className='flex flex-col items-center justify-center gap-10px p-24px rd-12px border border-dashed border-[var(--color-border-2)] bg-fill-1 hover:border-primary-6 hover:text-primary-6 hover:cursor-pointer transition-all w-full max-w-360px'
                  >
                    <span className='size-56px rounded-full bg-primary-1 text-primary-6 flex items-center justify-center'>
                      <Plus size={28} theme='outline' fill='currentColor' />
                    </span>
                    <span className='text-15px font-600 text-t-primary'>调用协同能力</span>
                    <span className='text-13px text-t-tertiary text-center'>
                      点击「+」叠加多个能力，发起深度闭环调用
                    </span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </Tabs.TabPane>
      </Tabs>

      <IdentityEditorModal
        visible={identityEditor.open}
        mode={identityEditor.mode}
        draft={identityEditor.draft}
        categories={identityCategories}
        skills={skills}
        onCancel={closeIdentityEditor}
        onSave={handleIdentitySave}
      />

      <SkillEditorModal
        visible={skillEditor.open}
        mode={skillEditor.mode}
        draft={skillEditor.draft}
        categories={skillCategories}
        onCancel={closeSkillEditor}
        onSave={handleSkillSave}
      />

      <CollabMultiExpertModal
        visible={multiExpertOpen}
        identities={identities}
        selected={multiSelected}
        onChange={setMultiSelected}
        onCancel={() => {
          deepLoopDirectiveRef.current = '';
          setMultiExpertOpen(false);
        }}
        onConfirm={handleLaunchMulti}
      />

      <CollabDeepLoopPicker
        visible={capabilityPickerOpen}
        features={collabFeatures}
        selected={selectedCaps}
        onToggle={handleToggleCap}
        onConfirm={handleConfirmDeepLoop}
        onCancel={() => setCapabilityPickerOpen(false)}
      />
    </HubPageShell>
  );
};

export default ExpertAgentsPage;
