import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLicense } from '@renderer/hooks/context/LicenseContext';

interface ProGateProps {
  /** Required license feature key (e.g. `team-consensus`). Omit to gate on any Pro activation. */
  feature?: string;
  /** Short hint shown on the lock overlay. */
  hint?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Wraps a premium surface. When the required license feature is not active, the
 * children are dimmed and a lock overlay prompts the user to activate. This is
 * the "智能体订阅解锁" demonstration: gated content becomes usable only after a
 * valid offline license is activated (see LicenseContext + /activate).
 */
const ProGate: React.FC<ProGateProps> = ({ feature, hint, className, children }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { active, hasFeature } = useLicense();

  const unlocked = active && hasFeature(feature);

  if (unlocked) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={`pro-gate ${className ?? ''}`}>
      <div style={{ opacity: 0.45, pointerEvents: 'none' }} aria-hidden='true'>
        {children}
      </div>
      <div className='pro-gate__lock'>
        <span className='pro-gate__badge'>PRO · {t('license.pro')}</span>
        <span className='pro-gate__hint'>{hint ?? t('license.lockedHint')}</span>
        <button type='button' className='pro-gate__btn' onClick={() => navigate('/activate')}>
          {t('license.unlockCta')}
        </button>
      </div>
    </div>
  );
};

export default ProGate;
