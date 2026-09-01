import loginLogo from '@renderer/assets/logos/brand/geekclaw-claw.png';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import AppLoader from '@renderer/components/layout/AppLoader';
import { useAuth } from '../../hooks/context/AuthContext';
import '../login/LoginPage.css';
import './RegisterPage.css';

type MessageState = {
  type: 'error' | 'success';
  text: string;
};

const RegisterPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { status, register } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [message, setMessage] = useState<MessageState | null>(null);
  const [loading, setLoading] = useState(false);

  const usernameRef = useRef<HTMLInputElement | null>(null);
  const messageTimer = useRef<number | undefined>(undefined);

  const showMessage = useCallback((msg: MessageState) => {
    setMessage(msg);
    if (messageTimer.current) {
      window.clearTimeout(messageTimer.current);
    }
    messageTimer.current = window.setTimeout(() => setMessage(null), 5000);
  }, []);

  useEffect(() => {
    document.body.classList.add('login-page-active');
    return () => {
      document.body.classList.remove('login-page-active');
      if (messageTimer.current) {
        window.clearTimeout(messageTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      void navigate('/guid', { replace: true });
    }
  }, [status, navigate]);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      const trimmedUsername = username.trim();
      if (!trimmedUsername || !password || !inviteCode.trim()) {
        showMessage({ type: 'error', text: t('register.errors.allFieldsRequired') });
        return;
      }

      if (password.length < 8) {
        showMessage({ type: 'error', text: t('register.errors.passwordTooShort') });
        return;
      }

      setLoading(true);

      const result = await register({
        username: trimmedUsername,
        password,
        inviteCode: inviteCode.trim(),
      });

      if (result.success) {
        showMessage({ type: 'success', text: t('register.success') });
        window.setTimeout(() => {
          void navigate('/guid', { replace: true });
        }, 600);
      } else {
        const errorText = (() => {
          // Backend rejects weak passwords with a raw English message
          // ("Password validation failed: Password is too common") — map it to
          // a friendly localized hint instead of surfacing the raw text.
          if (result.message && /too common|WeakPassword/i.test(result.message)) {
            return t('register.errors.passwordTooCommon');
          }
          switch (result.code) {
            case 'invalidInviteCode':
              return t('register.errors.invalidInviteCode');
            case 'usernameExists':
              return result.message ?? t('register.errors.unknown');
            case 'invalidCredentials':
              return result.message ?? t('register.errors.invalidInviteCode');
            case 'tooManyAttempts':
              return t('register.errors.tooManyAttempts');
            case 'networkError':
              return t('register.errors.networkError');
            case 'serverError':
              return t('register.errors.serverError');
            case 'unknown':
            default:
              return result.message ?? t('register.errors.unknown');
          }
        })();
        showMessage({ type: 'error', text: errorText });
      }

      setLoading(false);
    },
    [register, navigate, password, inviteCode, showMessage, t, username]
  );

  if (status === 'checking') {
    return <AppLoader />;
  }

  return (
    <div className='login-page'>
      <div className='login-page__card'>
        <div className='login-page__header'>
          <div className='login-page__logo'>
            <img src={loginLogo} alt={t('register.brand')} />
          </div>
          <h1 className='login-page__title'>{t('register.brand')}</h1>
          <p className='login-page__subtitle'>{t('register.subtitle')}</p>
        </div>

        <form className='login-page__form' onSubmit={handleSubmit}>
          <div className='login-page__form-item'>
            <label className='login-page__label' htmlFor='invite-code'>
              {t('register.inviteCode')}
            </label>
            <input
              id='invite-code'
              ref={usernameRef}
              className='login-page__input'
              type='text'
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder={t('register.inviteCodePlaceholder')}
              autoComplete='off'
              disabled={loading}
            />
          </div>

          <div className='login-page__form-item'>
            <label className='login-page__label' htmlFor='username'>
              {t('register.username')}
            </label>
            <input
              id='username'
              className='login-page__input'
              type='text'
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('register.usernamePlaceholder')}
              autoComplete='username'
              disabled={loading}
            />
          </div>

          <div className='login-page__form-item'>
            <label className='login-page__label' htmlFor='password'>
              {t('register.password')}
            </label>
            <div className='login-page__password-wrapper'>
              <input
                id='password'
                className='login-page__input'
                type={passwordVisible ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('register.passwordPlaceholder')}
                autoComplete='new-password'
                disabled={loading}
              />
              <button
                type='button'
                className='login-page__password-toggle'
                onClick={() => setPasswordVisible(!passwordVisible)}
                tabIndex={-1}
                aria-label={passwordVisible ? t('login.hidePassword') : t('login.showPassword')}
              >
                {passwordVisible ? '🙈' : '👁'}
              </button>
            </div>
            <div className='register-page__hint'>{t('register.passwordHint')}</div>
          </div>

          {message && (
            <div className={`login-page__message login-page__message--${message.type}`}>{message.text}</div>
          )}

          <button type='submit' className='login-page__submit' disabled={loading}>
            {loading ? t('register.registering') : t('register.submit')}
          </button>

          <div className='register-page__back-to-login'>
            <a href='#/login'>{t('register.backToLogin')}</a>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RegisterPage;
