import loginLogo from '@renderer/assets/logos/brand/geekclaw-claw.png';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import AppLoader from '@renderer/components/layout/AppLoader';
import { useLicense } from '@renderer/hooks/context/LicenseContext';
import '../login/LoginPage.css';
import './ActivatePage.css';

type MessageState = {
  type: 'error' | 'success' | 'info';
  text: string;
};

const formatDate = (ts: number | null): string => {
  if (!ts || ts <= 0) return '—';
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return '—';
  }
};

const ActivatePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { ready, active, edition, expiresAt, activatedAt, activate, deactivate } = useLicense();

  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<MessageState | null>(null);

  const showMessage = useCallback((msg: MessageState) => {
    setMessage(msg);
  }, []);

  const handleActivate = useCallback(async () => {
    const trimmed = key.trim();
    if (!trimmed) {
      showMessage({ type: 'error', text: t('license.errors.keyRequired') });
      return;
    }
    setLoading(true);
    const result = await activate(trimmed);
    setLoading(false);
    if (result.success) {
      showMessage({ type: 'success', text: t('license.activated') });
    } else {
      const map: Record<string, string> = {
        license_invalid: t('license.errors.invalidKey'),
        license_expired: t('license.errors.expired'),
        activate_failed: t('license.errors.activateFailed'),
      };
      showMessage({ type: 'error', text: map[result.message] ?? t('license.errors.invalidKey') });
    }
  }, [key, activate, showMessage, t]);

  const handleDeactivate = useCallback(async () => {
    setLoading(true);
    await deactivate();
    setLoading(false);
    showMessage({ type: 'info', text: t('license.deactivated') });
  }, [deactivate, showMessage, t]);

  if (!ready) {
    return <AppLoader />;
  }

  return (
    <div className='login-page'>
      <div className='login-page__card activate-card'>
        <div className='login-page__header'>
          <div className='login-page__logo'>
            <img src={loginLogo} alt='GeekClaw' />
          </div>
          <h1 className='login-page__title'>{t('license.brand')}</h1>
          <p className='login-page__subtitle'>{active ? t('license.subtitleActive') : t('license.subtitle')}</p>
        </div>

        {active ? (
          <div className='activate-status'>
            <div className='activate-badge activate-badge--active'>{t('license.statusActive')}</div>
            <dl className='activate-meta'>
              <div>
                <dt>{t('license.edition')}</dt>
                <dd>{edition ?? '—'}</dd>
              </div>
              <div>
                <dt>{t('license.activatedAt')}</dt>
                <dd>{formatDate(activatedAt)}</dd>
              </div>
              <div>
                <dt>{t('license.expiresAt')}</dt>
                <dd>{expiresAt ? formatDate(expiresAt) : t('license.never')}</dd>
              </div>
            </dl>
            <p className='activate-unlocked'>{t('license.unlocked')}</p>
            <button type='button' className='login-page__submit activate-deactivate' onClick={handleDeactivate} disabled={loading}>
              {loading ? t('license.deactivating') : t('license.deactivate')}
            </button>
          </div>
        ) : (
          <div className='login-page__form'>
            <div className='login-page__form-item'>
              <label className='login-page__label' htmlFor='license-key'>
                {t('license.enterKey')}
              </label>
              <textarea
                id='license-key'
                className='login-page__input activate-textarea'
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={t('license.keyPlaceholder')}
                rows={3}
                spellCheck={false}
                autoComplete='off'
                disabled={loading}
              />
            </div>

            {message && (
              <div className={`login-page__message login-page__message--${message.type}`}>{message.text}</div>
            )}

            <button type='button' className='login-page__submit' onClick={handleActivate} disabled={loading}>
              {loading ? t('license.activating') : t('license.activate')}
            </button>

            <p className='activate-hint'>{t('license.hint')}</p>
          </div>
        )}

        <button type='button' className='activate-back' onClick={() => navigate('/guid')}>
          {t('license.back')}
        </button>
      </div>
    </div>
  );
};

export default ActivatePage;
