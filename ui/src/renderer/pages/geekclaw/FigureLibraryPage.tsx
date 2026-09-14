/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Message, Modal, Spin } from '@arco-design/web-react';
import { Delete, Edit, Plus } from '@icon-park/react';
import { ipcBridge } from '@/common';
import { getBaseUrl, isBackendHttpError } from '@/common/adapter/httpBridge';
import type { IFigureMeta } from '@/common/adapter/ipcBridge';
import { figureImageUrlOf, customFigureMetaOf } from '@renderer/pages/companion/characters/customMeta';
import { BUILTIN_PERSON_FIGURES, builtinFigureMeta } from '@renderer/pages/companion/characters/builtinFigures';
import { CUSTOM_CHARACTER_ID } from '@renderer/pages/companion/characters';
import type { CompanionMood } from '@renderer/pages/companion/characters';
import CompanionAvatar from '@renderer/pages/companion/CompanionAvatar';
import { CHECKER_BG } from './CustomFigureWizard/FrameStep';
import CustomFigureWizard from './CustomFigureWizard';
import { FigureActionButton, FigureActionSurface, FigureActionVeil } from './FigureCardActions';
import FigureEditModal from './FigureEditModal';
import { figureToCustomPatch, useFigures, useFiguresInUse, type FigureUpdatePatch } from './useFigures';
import { useCompanions } from './useNomi';
import type { CompanionId, FigureId } from '@/common/types/ids';

/** One figure tile — thumbnail on a checker ground, inline rename, delete-on-hover. */
const FigureTile: React.FC<{
  fig: IFigureMeta;
  baseUrl: string;
  /** A companion currently uses this figure — deletion is blocked (would dangle). */
  inUse: boolean;
  onUpdate: (id: FigureId, patch: FigureUpdatePatch) => Promise<IFigureMeta>;
  onDelete: (fig: IFigureMeta) => void;
}> = ({ fig, baseUrl, inUse, onUpdate, onDelete }) => {
  const { t } = useTranslation();
  const [editOpen, setEditOpen] = useState(false);

  return (
    <>
      <div className='figure-library-card w-184px h-234px group relative flex shrink-0 flex-col overflow-hidden rd-16px bg-fill-2 border border-solid border-[var(--color-border-2)] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-2px hover:shadow-[0_10px_28px_rgba(var(--primary-rgb),0.16)] hover:border-[var(--color-primary)]'>
        {/* "in use" badge — always visible so the blocked delete reads as intentional */}
        {inUse && (
          <span className='absolute left-8px top-8px z-2 inline-flex items-center h-18px px-7px rd-full text-10px font-600 !bg-primary-1 !text-primary-6'>
            {t('geekclaw.customFigure.inUse')}
          </span>
        )}

        <FigureActionVeil />
        <FigureActionSurface>
          <FigureActionButton
            tone='primary'
            title={t('geekclaw.customFigure.editFigure')}
            ariaLabel={t('geekclaw.customFigure.editFigure')}
            onClick={() => setEditOpen(true)}
          >
            <Edit theme='outline' size='13' fill='currentColor' />
          </FigureActionButton>
          <FigureActionButton
            tone='danger'
            disabled={inUse}
            title={inUse ? t('geekclaw.customFigure.inUseCannotDelete') : t('geekclaw.customFigure.delete')}
            ariaLabel={inUse ? t('geekclaw.customFigure.inUseCannotDelete') : t('geekclaw.customFigure.delete')}
            onClick={() => { if (!inUse) onDelete(fig); }}
          >
            <Delete theme='outline' size='13' fill='currentColor' />
          </FigureActionButton>
        </FigureActionSurface>

        <div className='figure-library-card-preview h-190px flex shrink-0 items-center justify-center overflow-hidden' style={CHECKER_BG}>
          <img
            src={figureImageUrlOf(baseUrl, fig.figure_id, fig.created_at)}
            alt={fig.name}
            draggable={false}
            className='max-h-[88%] max-w-[88%] object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.18)]'
          />
        </div>

        <div className='figure-library-card-footer h-44px flex shrink-0 items-center gap-6px px-12px bg-fill-2'>
          <span className='text-13px font-600 text-t-primary truncate' title={fig.name}>
            {fig.name}
          </span>
        </div>
      </div>
      <FigureEditModal open={editOpen} fig={fig} baseUrl={baseUrl} onClose={() => setEditOpen(false)} onSave={onUpdate} />
    </>
  );
};

/**
 * 内置人物形象卡片 —— 专家数字分身市场同源的真实人物形象。
 *
 * 与自建形象同构（同尺寸卡片、同网格），差别只有两点：角标写「内置」，
 * 没有改名 / 删除，取而代之的主动作是「用于员工」——把该形象直接换到某个
 * 数字员工身上（character 切到 custom + 写入 custom_figure patch）。
 */
const BuiltinPersonTile: React.FC<{
  baseUrl: string;
  figure: IFigureMeta;
  onApply: (figure: IFigureMeta) => void;
}> = ({ baseUrl, figure, onApply }) => {
  const { t } = useTranslation();
  return (
    <div className='group w-184px h-234px relative flex shrink-0 flex-col overflow-hidden rd-16px bg-fill-2 border border-solid border-[var(--color-border-2)] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-2px hover:shadow-[0_10px_28px_rgba(var(--primary-rgb),0.16)] hover:border-[var(--color-primary)]'>
      <span className='absolute left-8px top-8px z-2 inline-flex items-center h-18px px-7px rd-full text-10px font-600 bg-[var(--color-bg-2)] text-t-tertiary border border-solid border-[var(--color-border-2)]'>
        {t('geekclaw.customFigure.builtinBadge')}
      </span>

      <div className='h-178px flex shrink-0 items-center justify-center overflow-hidden'>
        <img
          src={figureImageUrlOf(baseUrl, figure.figure_id)}
          alt={figure.name}
          draggable={false}
          className='w-124px h-124px rounded-full object-cover border border-solid border-[var(--color-border-2)] shadow-[0_6px_16px_rgba(0,0,0,0.14)]'
        />
      </div>

      <div className='flex-1 flex flex-col justify-center gap-6px px-12px pb-10px'>
        <span className='text-13px font-600 text-t-primary truncate' title={figure.name}>
          {figure.name}
        </span>
        <button
          type='button'
          onClick={() => onApply(figure)}
          className='h-24px rd-full px-10px text-12px font-500 cursor-pointer border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] text-t-secondary transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
        >
          {t('geekclaw.customFigure.useForCompanion')}
        </button>
      </div>
    </div>
  );
};

/**
 * 形象库 — the dedicated, discoverable home for reusable custom figures.
 * A gallery of figure assets (rename / delete) plus a prominent creation entry
 * that opens the DIY workspace. Decoupled from companions: figures live here and are
 * picked when creating/editing a companion.
 *
 * 2026-09-14：新增「人物形象」区块 —— 把专家数字分身市场的人物写实形象
 * （内置、随包分发）纳入形象库，并支持一键换装到某个数字员工。
 */
const FigureLibraryPage: React.FC = () => {
  const { t } = useTranslation();
  const { figures, loading, loaded, remove, update, add } = useFigures();
  const inUse = useFiguresInUse();
  const [wizardOpen, setWizardOpen] = useState(false);
  const base = getBaseUrl();

  /** 内置形象「用于员工」：当前待换装的形象 + 员工名册。 */
  const [applyFigure, setApplyFigure] = useState<IFigureMeta | null>(null);
  const [applying, setApplying] = useState(false);
  const { companions, loading: companionsLoading, refresh: refreshCompanions } = useCompanions();

  const builtinFigureMetas = React.useMemo(() => BUILTIN_PERSON_FIGURES.map(builtinFigureMeta), []);

  const confirmDelete = (fig: IFigureMeta): void => {
    Modal.confirm({
      title: t('geekclaw.customFigure.libraryTitle'),
      content: t('geekclaw.customFigure.deleteConfirm'),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        try {
          await remove(fig.figure_id);
        } catch (e) {
          // The backend refuses an in-use figure (409 Conflict) — covers the
          // rare case the roster was momentarily stale when the tile rendered.
          const msg =
            isBackendHttpError(e) && e.code === 'CONFLICT'
              ? t('geekclaw.customFigure.inUseCannotDelete')
              : `${t('geekclaw.customFigure.deleteFailed')}: ${String(e)}`;
          Message.error(msg);
        }
      },
    });
  };

  const applyToCompanion = async (companionId: CompanionId): Promise<void> => {
    if (!applyFigure || applying) return;
    setApplying(true);
    try {
      await ipcBridge.companion.patchCompanion.invoke({
        companion_id: companionId,
        patch: {
          // character 必须一起切到 custom，否则形象元数据不会被渲染层采纳。
          character: CUSTOM_CHARACTER_ID,
          appearance: { custom_figure: figureToCustomPatch(applyFigure) },
        },
      });
      Message.success(t('geekclaw.customFigure.applied'));
      setApplyFigure(null);
      await refreshCompanions();
    } catch (e) {
      Message.error(`${t('geekclaw.customFigure.applyFailed')}: ${String(e)}`);
    } finally {
      setApplying(false);
    }
  };

  const isEmpty = loaded && figures.length === 0;

  return (
    <div className='flex flex-col gap-16px py-8px'>
      {/* header */}
      <div className='flex items-end justify-between gap-12px flex-wrap'>
        <div className='flex flex-col gap-2px'>
          <h2 className='m-0 text-17px font-700 text-t-primary'>{t('geekclaw.customFigure.libraryTitle')}</h2>
          <span className='text-12px text-t-tertiary'>{t('geekclaw.customFigure.homeEntryHint')}</span>
        </div>
        <Button type='primary' icon={<Plus theme='outline' size='14' fill='currentColor' />} onClick={() => setWizardOpen(true)}>
          {t('geekclaw.customFigure.createNew')}
        </Button>
      </div>

      {/* 人物形象（内置）—— 专家数字分身市场同源的真实人物形象 */}
      <div className='flex flex-col gap-10px'>
        <div className='flex flex-col gap-2px'>
          <h3 className='m-0 text-14px font-600 text-t-primary'>
            {t('geekclaw.customFigure.builtinTitle')}
          </h3>
          <span className='text-12px text-t-tertiary'>{t('geekclaw.customFigure.builtinHint')}</span>
        </div>
        <div className='grid justify-start gap-14px' style={{ gridTemplateColumns: 'repeat(auto-fill, 184px)' }}>
          {builtinFigureMetas.map((figure) => (
            <BuiltinPersonTile
              key={figure.figure_id}
              baseUrl={base}
              figure={figure}
              onApply={setApplyFigure}
            />
          ))}
        </div>
      </div>

      {/* 我的形象 —— 用户自建立绘 */}
      <div className='flex flex-col gap-10px'>
        <div className='flex flex-col gap-2px'>
          <h3 className='m-0 text-14px font-600 text-t-primary'>
            {t('geekclaw.customFigure.libraryTitle')}
          </h3>
        </div>
        {loading && !loaded ? (
          <div className='flex justify-center py-60px'>
            <Spin />
          </div>
        ) : isEmpty ? (
          <div className='flex flex-col items-center justify-center gap-14px py-56px rd-16px bg-fill-1 border border-dashed border-[var(--color-border-2)]'>
            <div className='flex items-center justify-center w-72px h-72px rd-full bg-primary-1 text-32px text-primary-6'>
              <Plus theme='outline' size='14' fill='currentColor' />
            </div>
            <div className='flex flex-col items-center gap-4px'>
              <span className='text-14px font-600 text-t-primary'>{t('geekclaw.customFigure.libraryEmpty')}</span>
              <span className='text-12px text-t-tertiary'>{t('geekclaw.customFigure.copyrightHint')}</span>
            </div>
            <Button type='primary' icon={<Plus theme='outline' size='14' fill='currentColor' />} onClick={() => setWizardOpen(true)}>
              {t('geekclaw.customFigure.createNew')}
            </Button>
          </div>
        ) : (
          <div className='grid justify-start gap-14px' style={{ gridTemplateColumns: 'repeat(auto-fill, 184px)' }}>
            {figures.map((fig) => (
              <FigureTile
                key={fig.figure_id}
                fig={fig}
                baseUrl={base}
                inUse={inUse.has(fig.figure_id)}
                onUpdate={update}
                onDelete={confirmDelete}
              />
            ))}
            {/* trailing create tile keeps creation in-reach next to the assets */}
            <button
              type='button'
              onClick={() => setWizardOpen(true)}
              className='figure-library-card w-184px h-234px figure-library-create-card flex shrink-0 flex-col items-center justify-center gap-8px rd-16px bg-fill-1 text-t-tertiary cursor-pointer transition-all duration-200 hover:-translate-y-2px hover:bg-fill-2 hover:text-[var(--color-primary)]'
            >
              <span className='figure-library-create-content flex flex-col items-center gap-8px'>
                <span className='flex items-center justify-center w-44px h-44px rd-full bg-fill-3 text-26px'>
                  <Plus theme='outline' size='14' fill='currentColor' />
                </span>
                <span className='text-12px font-600'>{t('geekclaw.customFigure.createNew')}</span>
              </span>
            </button>
          </div>
        )}
      </div>

      <CustomFigureWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onDone={(figure) => {
          setWizardOpen(false);
          add(figure);
          Message.success(t('geekclaw.customFigure.savedToLibrary'));
        }}
      />

      {/* 内置形象 → 选员工换装 */}
      <Modal
        title={t('geekclaw.customFigure.applyTitle')}
        visible={applyFigure !== null}
        onCancel={() => setApplyFigure(null)}
        footer={null}
        style={{ width: 440, maxWidth: 'calc(100vw - 32px)' }}
      >
        {applyFigure && (
          <div className='flex flex-col gap-12px'>
            <div className='flex items-center gap-12px'>
              <img
                src={figureImageUrlOf(base, applyFigure.figure_id)}
                alt={applyFigure.name}
                draggable={false}
                className='w-56px h-56px rounded-full object-cover border border-solid border-[var(--color-border-2)] shrink-0'
              />
              <div className='min-w-0'>
                <div className='text-14px font-600 text-t-primary truncate'>{applyFigure.name}</div>
                <div className='text-12px text-t-tertiary'>{t('geekclaw.customFigure.applyHint')}</div>
              </div>
            </div>
            {companionsLoading && companions.length === 0 ? (
              <div className='flex justify-center py-24px'>
                <Spin />
              </div>
            ) : companions.length === 0 ? (
              <div className='py-24px text-center text-12px text-t-tertiary'>
                {t('geekclaw.customFigure.noCompanion')}
              </div>
            ) : (
              <div className='flex flex-col gap-8px max-h-320px overflow-y-auto'>
                {companions.map((companion) => (
                  <div
                    key={companion.companion_id}
                    role='button'
                    tabIndex={0}
                    onClick={() => void applyToCompanion(companion.companion_id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        void applyToCompanion(companion.companion_id);
                      }
                    }}
                    className='flex items-center gap-10px h-52px rd-10px px-12px cursor-pointer box-border outline-none border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] hover:border-[var(--color-primary)] transition-colors'
                  >
                    <CompanionAvatar
                      character={companion.character}
                      companionId={companion.companion_id}
                      customFigure={customFigureMetaOf(companion)}
                      mood={(companion.status?.mood as CompanionMood) || 'content'}
                      activity='idle'
                      size={30}
                    />
                    <span className='min-w-0 flex-1 text-13px text-t-primary truncate'>{companion.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default FigureLibraryPage;
