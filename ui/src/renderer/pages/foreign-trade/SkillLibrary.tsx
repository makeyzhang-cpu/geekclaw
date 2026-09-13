/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Message } from '@arco-design/web-react';
import { Download, Left, Plus, Search, Upload } from '@icon-park/react';
import { groupBySkillCategory, type ExpertSkill } from '@renderer/pages/expert-agents/data';
import { SkillCard, SkillEditorModal, emptySkillDraft } from '@renderer/pages/expert-agents/expertEditors';
import type { SkillEditorState } from '@renderer/pages/expert-agents/expertEditors';

interface SkillLibraryProps {
  skills: ExpertSkill[];
  /** Skill-id mint function from useExpertSkills — kept in the parent so there is
   *  exactly one copy of the persisted list (the hook is not shared-state safe). */
  createId: () => string;
  onSave: (item: ExpertSkill) => void;
  onDelete: (item: ExpertSkill) => void;
  /** Start a conversation from a single skill (synthetic identity). */
  onLaunchSkill: (item: ExpertSkill) => void;
  onImport: (file: File) => void;
  onExport: () => void;
  onBack: () => void;
}

/**
 * 专家技能库 — B2B 外贸工作台的技能管理视图。
 *
 * Reuses the very same SkillCard / SkillEditorModal as 数字外贸团队 so the two
 * surfaces cannot drift. The persisted skill list itself lives in the parent
 * (useExpertSkills); this component only owns view state.
 */
const SkillLibrary: React.FC<SkillLibraryProps> = ({
  skills,
  createId,
  onSave,
  onDelete,
  onLaunchSkill,
  onImport,
  onExport,
  onBack,
}) => {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState('');
  const [editor, setEditor] = useState<SkillEditorState>({
    open: false,
    mode: 'edit',
    draft: emptySkillDraft(''),
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const matched = q
      ? skills.filter(
          (item) =>
            item.name.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q) ||
            item.category.toLowerCase().includes(q)
        )
      : skills;
    return groupBySkillCategory(matched);
  }, [skills, keyword]);

  const categories = useMemo(
    () => Array.from(new Set(skills.map((s) => s.category))),
    [skills]
  );

  const closeEditor = () => setEditor((s) => ({ ...s, open: false }));

  const handleDelete = (item: ExpertSkill) => {
    onDelete(item);
  };

  return (
    <div className='flex-1 min-w-0 min-h-0 flex flex-col'>
      <div className='shrink-0 px-16px md:px-24px pt-20px pb-12px flex flex-col gap-12px'>
        <div className='flex items-center justify-between gap-12px flex-wrap'>
          <div className='flex items-center gap-8px min-w-0'>
            <button
              onClick={onBack}
              className='flex items-center gap-4px text-13px text-t-secondary hover:text-primary-6 cursor-pointer transition-colors shrink-0'
            >
              <Left theme='outline' size='16' />
              {t('foreignTrade.back', { defaultValue: '返回' })}
            </button>
            <span className='text-16px font-600 text-t-primary truncate'>
              {t('foreignTrade.skillLibrary', { defaultValue: '专家技能库' })}
            </span>
            <span className='text-12px text-t-quaternary shrink-0'>({skills.length})</span>
          </div>
          <div className='flex items-center gap-8px shrink-0'>
            <input
              ref={fileRef}
              type='file'
              accept='application/json'
              className='hidden'
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImport(file);
                event.target.value = '';
              }}
            />
            <Button size='small' icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>
              {t('foreignTrade.skillImport', { defaultValue: '导入' })}
            </Button>
            <Button size='small' icon={<Download size={14} />} onClick={onExport}>
              {t('foreignTrade.skillExport', { defaultValue: '导出' })}
            </Button>
            <Button
              type='primary'
              size='small'
              icon={<Plus size={14} />}
              onClick={() =>
                setEditor({ open: true, mode: 'create', draft: emptySkillDraft(createId()) })
              }
            >
              {t('foreignTrade.skillCreate', { defaultValue: '新建技能' })}
            </Button>
          </div>
        </div>
        <Input
          value={keyword}
          onChange={setKeyword}
          allowClear
          prefix={<Search theme='outline' size='14' fill='currentColor' />}
          placeholder={t('foreignTrade.searchSkill', { defaultValue: '搜索专家技能' })}
          className='max-w-360px'
        />
      </div>

      <div className='flex-1 min-h-0 overflow-y-auto px-16px md:px-24px pb-32px'>
        {skills.length === 0 ? (
          <div className='flex flex-col items-center justify-center gap-10px py-64px text-center'>
            <span className='text-14px font-500 text-t-primary'>
              {t('foreignTrade.noSkill', { defaultValue: '还没有专家技能' })}
            </span>
            <span className='max-w-360px text-13px leading-20px text-t-tertiary'>
              {t('foreignTrade.noSkillHint', {
                defaultValue: '技能是专家身份的能力单元，可编辑、可导入导出，供专家调用时执行。',
              })}
            </span>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.category} className='mb-8px'>
              <h3 className='text-13px font-600 text-t-secondary mt-18px mb-10px'>
                {group.category}
              </h3>
              <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-12px'>
                {group.items.map((item) => (
                  <SkillCard
                    key={item.id}
                    item={item}
                    onEdit={(target) => setEditor({ open: true, mode: 'edit', draft: target })}
                    onDelete={handleDelete}
                    onLaunchSkill={onLaunchSkill}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      <SkillEditorModal
        visible={editor.open}
        mode={editor.mode}
        draft={editor.draft}
        categories={categories}
        onCancel={closeEditor}
        onSave={(item) => {
          onSave(item);
          closeEditor();
          Message.success(t('foreignTrade.skillSaved', { defaultValue: '技能已保存' }));
        }}
      />
    </div>
  );
};

export default SkillLibrary;
