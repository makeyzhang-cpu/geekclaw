/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Message, Modal, Popover, Tooltip } from '@arco-design/web-react';
import { Theme } from '@icon-park/react';
import classNames from 'classnames';
import AppearancePanel from '@renderer/components/settings/AppearancePanel';
import CssThemeModal from '@renderer/pages/settings/DisplaySettings/CssThemeModal';
import { useCssTheme } from '@renderer/hooks/ui/useCssTheme';
import type { ICssTheme } from '@/common/config/storage';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';

interface SiderThemeControlProps {
  isMobile: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
}

const footerButtonClass = (collapsed: boolean, isMobile: boolean, active: boolean) =>
  classNames(
    'h-32px shrink-0 flex items-center justify-center cursor-pointer rd-0.5rem transition-colors',
    collapsed ? 'w-full' : 'w-36px',
    isMobile && 'sider-footer-btn-mobile',
    active ? '!bg-primary-1 !text-primary-6' : 'text-t-secondary hover:bg-fill-2 hover:text-t-primary active:bg-fill-3'
  );

/**
 * SiderThemeControl — the footer theme entry that lives right next to 设置.
 *
 * It is the complete home for everything the former Display settings page
 * covered: a popover with the light/dark axis (ThemeSwitcher), interface
 * scaling (FontSizeControl), and the CSS preset/skin list (via the shared
 * `useCssTheme` hook). Each preset gets a hover edit affordance and a trailing
 * "add CSS" entry, both opening the self-contained `CssThemeModal`.
 *
 * The modal is rendered as a sibling of the Popover (never inside its content)
 * so it survives the popover unmounting when the user clicks into the editor.
 */
const SiderThemeControl: React.FC<SiderThemeControlProps> = ({ isMobile, collapsed, siderTooltipProps }) => {
  const { t } = useTranslation();
  const { saveUserTheme, deleteUserTheme } = useCssTheme();
  const [popupVisible, setPopupVisible] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTheme, setEditingTheme] = useState<ICssTheme | null>(null);

  // Opening the editor always closes the popover first so the modal isn't
  // anchored inside a popup that vanishes when focus moves.
  const openModal = (theme: ICssTheme | null) => {
    setPopupVisible(false);
    setEditingTheme(theme);
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setEditingTheme(null);
  };

  const handleSave = async (data: Omit<ICssTheme, 'id' | 'created_at' | 'updated_at' | 'is_preset'>) => {
    await saveUserTheme(data, editingTheme);
    closeModal();
    Message.success(t('common.saveSuccess'));
  };

  // Delete is only offered for a real (non-preset) user theme.
  const canDelete = !!editingTheme && !editingTheme.is_preset;
  const handleDelete = () => {
    if (!editingTheme || editingTheme.is_preset) return;
    const target = editingTheme;
    Modal.confirm({
      title: t('common.confirmDelete'),
      content: t('settings.cssTheme.deleteConfirm'),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        await deleteUserTheme(target.id);
        closeModal();
        Message.success(t('common.deleteSuccess'));
      },
    });
  };

  return (
    <>
      <Popover
        className='sider-soft-popover sider-theme-popover'
        trigger='click'
        position={collapsed ? 'rt' : 'top'}
        popupVisible={popupVisible}
        onVisibleChange={setPopupVisible}
        getPopupContainer={() => document.body}
        content={<AppearancePanel onEditTheme={openModal} />}
        unmountOnExit
      >
        <Tooltip {...siderTooltipProps} content={t('settings.theme')} position='right'>
          <div className={footerButtonClass(collapsed, isMobile, popupVisible)} aria-label={t('settings.theme')}>
            <Theme theme='outline' size='18' fill='currentColor' className='block leading-none' style={{ lineHeight: 0 }} />
          </div>
        </Tooltip>
      </Popover>

      <CssThemeModal
        visible={modalVisible}
        theme={editingTheme}
        onClose={closeModal}
        onSave={(data) => void handleSave(data)}
        onDelete={canDelete ? handleDelete : undefined}
      />
    </>
  );
};

export default SiderThemeControl;
