import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { httpRequest } from '@/common/adapter/httpBridge';
import type {
  BillingBalance,
  CreditTransactionInfo,
  ListUsersResponse,
  ModelPriceInfo,
  ModelPriceListResponse,
  UserListItem,
} from '@/common/types/billing/billingTypes';
import './index.css';

const TX_TYPE_LABELS: Record<string, string> = {
  signup_bonus: '注册赠送',
  invite_reward: '邀请奖励',
  adjust: '管理员调整',
  consume: '对话消耗',
};

function formatTime(ms: number): string {
  if (!ms) return '-';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '-';
  }
}

const BillingPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [balance, setBalance] = useState<BillingBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Admin state
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [prices, setPrices] = useState<ModelPriceInfo[]>([]);
  const [targetUser, setTargetUser] = useState('');
  const [delta, setDelta] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [planTarget, setPlanTarget] = useState('');
  const [plan, setPlan] = useState('free');
  const [adminMsg, setAdminMsg] = useState<string | null>(null);

  // Price form
  const [pProvider, setPProvider] = useState('');
  const [pModel, setPModel] = useState('');
  const [pTask, setPTask] = useState('Chat');
  const [pInput, setPInput] = useState('');
  const [pOutput, setPOutput] = useState('');
  const [pCache, setPCache] = useState('');
  const [pCurrency, setPCurrency] = useState('credits');
  const [priceMsg, setPriceMsg] = useState<string | null>(null);

  const loadBalance = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 桌面端：积分/钱包/流水以云端管理后台为唯一真源，走本地后端代理
      // `/api/store/me`（转发到云端 /api/billing/me，带云端 JWT）。
      const data = await httpRequest<BillingBalance>('GET', '/api/store/me');
      setBalance(data);
    } catch (e) {
      setError(t('billing.errors.loadFailed'));
      console.error('[billing] loadBalance failed', e);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadAdmin = useCallback(async () => {
    try {
      const [u, p] = await Promise.all([
        httpRequest<ListUsersResponse>('GET', '/api/auth/users'),
        httpRequest<ModelPriceListResponse>('GET', '/api/billing/pricing'),
      ]);
      setUsers(u.users ?? []);
      setPrices(p.prices ?? []);
    } catch (e) {
      console.error('[billing] loadAdmin failed', e);
    }
  }, []);

  useEffect(() => {
    loadBalance();
    if (isAdmin) loadAdmin();
  }, [loadBalance, loadAdmin, isAdmin]);

  const handleAdjust = useCallback(async () => {
    setAdminMsg(null);
    if (!targetUser) return;
    const d = Number(delta);
    if (!Number.isFinite(d) || d === 0) return;
    try {
      const data = await httpRequest<BillingBalance>('POST', `/api/billing/users/${encodeURIComponent(targetUser)}/adjust`, {
        delta: d,
        note: adjustNote || null,
      });
      setAdminMsg(`${t('billing.admin.adjusted')} ${data.credits}`);
      setBalance(data);
      setDelta('');
      setAdjustNote('');
      if (isAdmin) loadAdmin();
    } catch (e) {
      setAdminMsg(t('billing.errors.adjustFailed'));
      console.error('[billing] adjust failed', e);
    }
  }, [targetUser, delta, adjustNote, t, isAdmin, loadAdmin]);

  const handleSetPlan = useCallback(async () => {
    setAdminMsg(null);
    if (!planTarget) return;
    try {
      await httpRequest<null>('POST', `/api/auth/users/${encodeURIComponent(planTarget)}/plan`, { plan });
      setAdminMsg(`${t('billing.admin.planUpdated')} ${plan}`);
      if (isAdmin) loadAdmin();
    } catch (e) {
      setAdminMsg(t('billing.errors.setPlanFailed'));
      console.error('[billing] setPlan failed', e);
    }
  }, [planTarget, plan, t, isAdmin, loadAdmin]);

  const handleSavePrice = useCallback(async () => {
    setPriceMsg(null);
    const input = Number(pInput);
    const output = Number(pOutput);
    const cache = Number(pCache);
    if (!pProvider.trim() || !pModel.trim()) return;
    if (![input, output, cache].every((n) => Number.isFinite(n))) return;
    try {
      await httpRequest<ModelPriceInfo>('PUT', '/api/billing/pricing', {
        provider: pProvider.trim(),
        model: pModel.trim(),
        task: pTask.trim() || 'Chat',
        input_credits_per_1k: input,
        output_credits_per_1k: output,
        cache_read_credits_per_1k: cache,
        currency: pCurrency.trim() || 'credits',
      });
      setPriceMsg(t('billing.admin.priceSaved'));
      setPProvider('');
      setPModel('');
      setPTask('Chat');
      setPInput('');
      setPOutput('');
      setPCache('');
      setPCurrency('credits');
      if (isAdmin) loadAdmin();
    } catch (e) {
      setPriceMsg(t('billing.errors.priceFailed'));
      console.error('[billing] savePrice failed', e);
    }
  }, [pProvider, pModel, pTask, pInput, pOutput, pCache, pCurrency, t, isAdmin, loadAdmin]);

  return (
    <div className='billing-page'>
      <header className='billing-header'>
        <h1>{t('billing.title')}</h1>
        <p className='billing-subtitle'>{t('billing.subtitle')}</p>
      </header>

      {loading && <div className='billing-loading'>{t('billing.loading')}</div>}
      {error && <div className='billing-error'>{error}</div>}

      {balance && (
        <section className='billing-wallet'>
          <div className='billing-stat'>
            <span className='billing-stat-label'>{t('billing.plan')}</span>
            <span className='billing-stat-value'>{balance.plan || 'free'}</span>
          </div>
          <div className='billing-stat'>
            <span className='billing-stat-label'>{t('billing.credits')}</span>
            <span className='billing-stat-value billing-credits'>{balance.credits}</span>
          </div>
        </section>
      )}

      {balance && (
        <section className='billing-ledger'>
          <h2>{t('billing.transactions')}</h2>
          {balance.transactions.length === 0 ? (
            <div className='billing-empty'>{t('billing.noTransactions')}</div>
          ) : (
            <table className='billing-table'>
              <thead>
                <tr>
                  <th>{t('billing.txType')}</th>
                  <th>{t('billing.txAmount')}</th>
                  <th>{t('billing.txBalance')}</th>
                  <th>{t('billing.txNote')}</th>
                  <th>{t('billing.txTime')}</th>
                </tr>
              </thead>
              <tbody>
                {balance.transactions.map((tx: CreditTransactionInfo) => (
                  <tr key={tx.id}>
                    <td>{TX_TYPE_LABELS[tx.tx_type] ?? tx.tx_type}</td>
                    <td className={tx.amount >= 0 ? 'billing-pos' : 'billing-neg'}>
                      {tx.amount >= 0 ? `+${tx.amount}` : tx.amount}
                    </td>
                    <td>{tx.balance_after}</td>
                    <td className='billing-note'>{tx.note ?? '-'}</td>
                    <td>{formatTime(tx.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {isAdmin && (
        <section className='billing-admin'>
          <h2>{t('billing.admin.title')}</h2>
          <p className='billing-subtitle'>{t('billing.admin.desc')}</p>

          {adminMsg && <div className='billing-admin-msg'>{adminMsg}</div>}

          <div className='billing-admin-grid'>
            <div className='billing-card'>
              <h3>{t('billing.admin.adjustTitle')}</h3>
              <label>
                {t('billing.admin.targetUser')}
                <select value={targetUser} onChange={(e) => setTargetUser(e.target.value)}>
                  <option value=''>{t('billing.admin.targetUser')}</option>
                  {users.map((u) => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.username} ({u.plan} / {u.credits})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('billing.admin.delta')}
                <input type='number' value={delta} onChange={(e) => setDelta(e.target.value)} />
              </label>
              <label>
                {t('billing.admin.note')}
                <input value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} />
              </label>
              <button type='button' className='billing-btn' onClick={handleAdjust}>
                {t('billing.admin.submitAdjust')}
              </button>
            </div>

            <div className='billing-card'>
              <h3>{t('billing.admin.planTitle')}</h3>
              <label>
                {t('billing.admin.targetUser')}
                <select value={planTarget} onChange={(e) => setPlanTarget(e.target.value)}>
                  <option value=''>{t('billing.admin.targetUser')}</option>
                  {users.map((u) => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.username} ({u.plan})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('billing.admin.setPlan')}
                <select value={plan} onChange={(e) => setPlan(e.target.value)}>
                  <option value='free'>free</option>
                  <option value='pro'>pro</option>
                  <option value='team'>team</option>
                </select>
              </label>
              <button type='button' className='billing-btn' onClick={handleSetPlan}>
                {t('billing.admin.setPlan')}
              </button>
            </div>
          </div>

          <div className='billing-card billing-price-card'>
            <h3>{t('billing.admin.pricingTitle')}</h3>
            {priceMsg && <div className='billing-admin-msg'>{priceMsg}</div>}
            <div className='billing-price-form'>
              <input placeholder={t('billing.admin.provider')} value={pProvider} onChange={(e) => setPProvider(e.target.value)} />
              <input placeholder={t('billing.admin.model')} value={pModel} onChange={(e) => setPModel(e.target.value)} />
              <input placeholder={t('billing.admin.task')} value={pTask} onChange={(e) => setPTask(e.target.value)} />
              <input placeholder={t('billing.admin.inputPer1k')} type='number' value={pInput} onChange={(e) => setPInput(e.target.value)} />
              <input placeholder={t('billing.admin.outputPer1k')} type='number' value={pOutput} onChange={(e) => setPOutput(e.target.value)} />
              <input placeholder={t('billing.admin.cacheReadPer1k')} type='number' value={pCache} onChange={(e) => setPCache(e.target.value)} />
              <input placeholder={t('billing.admin.currency')} value={pCurrency} onChange={(e) => setPCurrency(e.target.value)} />
              <button type='button' className='billing-btn' onClick={handleSavePrice}>
                {t('billing.admin.savePrice')}
              </button>
            </div>

            {prices.length === 0 ? (
              <div className='billing-empty'>{t('billing.admin.noPrices')}</div>
            ) : (
              <table className='billing-table'>
                <thead>
                  <tr>
                    <th>{t('billing.admin.provider')}</th>
                    <th>{t('billing.admin.model')}</th>
                    <th>{t('billing.admin.task')}</th>
                    <th>{t('billing.admin.inputPer1k')}</th>
                    <th>{t('billing.admin.outputPer1k')}</th>
                    <th>{t('billing.admin.cacheReadPer1k')}</th>
                    <th>{t('billing.admin.currency')}</th>
                  </tr>
                </thead>
                <tbody>
                  {prices.map((p) => (
                    <tr key={p.id}>
                      <td>{p.provider}</td>
                      <td>{p.model}</td>
                      <td>{p.task}</td>
                      <td>{p.input_credits_per_1k}</td>
                      <td>{p.output_credits_per_1k}</td>
                      <td>{p.cache_read_credits_per_1k}</td>
                      <td>{p.currency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}
    </div>
  );
};

export default BillingPage;
