/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Input, Select, Message as ToastMessage } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
// NOTE: keep this import single-line and alias-free. The `vite-plugin-icon-park`
// transform rewrites `@icon-park/react` specifiers with a regex that only accepts
// letters/commas/spaces — an `X as Y` alias makes it emit invalid code. Aliasing
// the Arco `Message` instead keeps both names unambiguous.
import { Delete, Edit, Message } from '@icon-park/react';
import NomiModal from '@renderer/components/base/NomiModal';
import type { ExpertIdentity, ExpertSkill } from './data';
import { expertIconOptions, resolveExpertIcon } from './expertIcons';

/** 专家身份 / 专家技能 的编辑弹窗与技能卡片。
 *
 * 这些组件原本定义在 expert-agents/index.tsx 内部。为让 B2B 外贸工作台
 * （pages/foreign-trade）复用同一套编辑能力，抽成共享模块，新旧两页共用，
 * 避免两份实现各自漂移。
 */
export interface SkillCardProps {
  item: ExpertSkill;
  onEdit: (item: ExpertSkill) => void;
  onDelete: (item: ExpertSkill) => void;
  onLaunchSkill: (item: ExpertSkill) => void;
}

export const SkillCard: React.FC<SkillCardProps> = ({ item, onEdit, onDelete, onLaunchSkill }) => {
  const Icon = resolveExpertIcon(item.icon);
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
          icon={<Message size={15} />}
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

export interface IdentityEditorState {
  open: boolean;
  mode: 'create' | 'edit';
  draft: ExpertIdentity;
}

export interface SkillEditorState {
  open: boolean;
  mode: 'create' | 'edit';
  draft: ExpertSkill;
}

export interface BaseEditorModalProps<T> {
  visible: boolean;
  mode: 'create' | 'edit';
  draft: T;
  categories: string[];
  onCancel: () => void;
  onSave: (item: T) => void;
}

export interface IdentityEditorModalProps extends BaseEditorModalProps<ExpertIdentity> {
  skills: ExpertSkill[];
}

export const IdentityEditorModal: React.FC<IdentityEditorModalProps> = ({
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

  const PreviewIcon = resolveExpertIcon(icon);

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      ToastMessage.error('请填写专家身份名称');
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
              options={expertIconOptions}
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

export const SkillEditorModal: React.FC<BaseEditorModalProps<ExpertSkill>> = ({
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

  const PreviewIcon = resolveExpertIcon(icon);

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      ToastMessage.error('请填写技能名称');
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
              options={expertIconOptions}
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
export const CollabMultiExpertModal: React.FC<{
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
          const I = resolveExpertIcon(it.icon);
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

export const emptyIdentityDraft = (id: string): ExpertIdentity => ({
  id,
  name: '',
  category: '',
  description: '',
  icon: 'People',
  skillIds: [],
});

export const emptySkillDraft = (id: string): ExpertSkill => ({
  id,
  name: '',
  category: '',
  description: '',
  icon: 'People',
  definition: '',
});
