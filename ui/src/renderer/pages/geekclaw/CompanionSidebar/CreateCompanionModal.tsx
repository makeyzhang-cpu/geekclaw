/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Message, Modal } from '@arco-design/web-react';
import { Pic } from '@icon-park/react';
import { ipcBridge } from '@/common';
import { CUSTOM_CHARACTER_ID, DEFAULT_CHARACTER_ID } from '@renderer/pages/companion/characters';
import CharacterPicker from '../CharacterPicker';
import { figureToCustomPatch } from '../useFigures';
import type { ICompanionProfile, IFigureMeta } from '@/common/adapter/ipcBridge';

interface Props {
  visible: boolean;
  onCancel: () => void;
  onCreated: (profile: ICompanionProfile) => void | Promise<void>;
  /** 形象库 — closes the dialog and opens the full figure library view. */
  onOpenFigures?: () => void;
}

/**
 * 新建员工 — name plus appearance, the only two things needed before a companion
 * exists. Everything else is configured afterwards in 总览.
 *
 * Extracted from the former CompanionSessionRail so the sidebar stays a pure
 * roster view and creation is owned by the page shell.
 */
const CreateCompanionModal: React.FC<Props> = ({ visible, onCancel, onCreated, onOpenFigures }) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [character, setCharacter] = useState<string>(DEFAULT_CHARACTER_ID);
  /** A library figure chosen for the new companion (overrides `character`). */
  const [figure, setFigure] = useState<IFigureMeta | null>(null);
  const [creating, setCreating] = useState(false);

  // Reset on each open so a cancelled attempt never leaks into the next one.
  React.useEffect(() => {
    if (!visible) return;
    setName('');
    setCharacter(DEFAULT_CHARACTER_ID);
    setFigure(null);
  }, [visible]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const profile = await ipcBridge.companion.createCompanion.invoke({
        name: trimmed,
        character: figure ? CUSTOM_CHARACTER_ID : character,
      });
      // createCompanion only accepts name + character; a library figure is linked
      // by a follow-up patch before the roster refresh in onCreated.
      if (figure) {
        await ipcBridge.companion.patchCompanion.invoke({
          companion_id: profile.companion_id,
          patch: { appearance: { custom_figure: figureToCustomPatch(figure) } },
        });
      }
      onCancel();
      try {
        await onCreated(profile);
      } catch (refreshError) {
        Message.warning(`${t('geekclaw.companions.created', { companionName: profile.name })}: ${String(refreshError)}`);
        return;
      }
      Message.success(t('geekclaw.companions.created', { companionName: profile.name }));
    } catch (error) {
      Message.error(String(error));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      title={
        <div className='w-full text-center text-20px font-600'>{t('geekclaw.companions.createTitle')}</div>
      }
      visible={visible}
      onCancel={onCancel}
      footer={
        <div className='flex items-center justify-between w-full'>
          {/* 形象库 — hands over to the full library view (shell closes this dialog). */}
          {onOpenFigures ? (
            <Button
              size='small'
              icon={<Pic theme='outline' size='14' fill='currentColor' strokeWidth={3} />}
              onClick={onOpenFigures}
            >
              {t('geekclaw.customFigure.libraryTitle')}
            </Button>
          ) : (
            <span />
          )}
          <div className='flex items-center gap-8px'>
            <Button size='small' onClick={onCancel}>
              {t('geekclaw.desk.cancel', { defaultValue: '取消' })}
            </Button>
            <Button
              type='primary'
              size='small'
              loading={creating}
              disabled={!name.trim()}
              onClick={() => void submit()}
            >
              {t('geekclaw.desk.ok', { defaultValue: '确定' })}
            </Button>
          </div>
        </div>
      }
      style={{ width: 560 }}
    >
      <div className='flex flex-col gap-14px'>
        <div className='flex flex-col gap-6px'>
          <span className='text-13px text-t-secondary'>{t('geekclaw.companions.nameLabel')}</span>
          <Input
            value={name}
            onChange={setName}
            placeholder={t('geekclaw.companions.namePlaceholder')}
            maxLength={30}
            onPressEnter={() => void submit()}
          />
        </div>
        <div className='flex flex-col gap-6px'>
          <span className='text-13px text-t-secondary'>{t('geekclaw.companions.characterLabel')}</span>
          <CharacterPicker
            value={figure ? CUSTOM_CHARACTER_ID : character}
            figureId={figure?.figure_id}
            onSelectCharacter={(id) => {
              setCharacter(id);
              setFigure(null);
            }}
            onSelectFigure={setFigure}
          />
        </div>
      </div>
    </Modal>
  );
};

export default CreateCompanionModal;
