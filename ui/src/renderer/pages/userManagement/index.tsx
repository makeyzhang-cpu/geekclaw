import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { buildBackendAuthHeaders } from '@/common/adapter/httpBridge';
import { Message } from '@arco-design/web-react';
import './index.css';

interface UserItem {
  user_id: string;
  username: string;
  role: string;
  is_active: boolean;
  last_login: number | null;
}

interface InvitationItem {
  code: string;
  created_by: string;
  created_at: number;
  expires_at: number;
  used_by: string | null;
  used_at: number | null;
}

type ApiError = Error & { status?: number; code?: string };

async function apiFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { ...buildBackendAuthHeaders(method) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const resp = await fetch(path, {
    method,
    credentials: 'include',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    const err = new Error(
      (data?.message as string) || (data?.error as string) || `Request failed: ${resp.status}`
    ) as ApiError;
    err.status = resp.status;
    err.code = data?.code as string | undefined;
    throw err;
  }
  return data as T;
}

const formatTime = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined || ms === 0) return '—';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '—';
  }
};

const UserManagementPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<'users' | 'invitations'>('users');
  const [users, setUsers] = useState<UserItem[]>([]);
  const [invitations, setInvitations] = useState<InvitationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [createdExpiresAt, setCreatedExpiresAt] = useState<number | null>(null);
  const [expiryDays, setExpiryDays] = useState(7);

  const myId = user?.id;

  const loadUsers = useCallback(async () => {
    try {
      const data = await apiFetch<{ success: boolean; users: UserItem[] }>('GET', '/api/auth/users');
      setUsers(data.users ?? []);
    } catch (err) {
      console.error('Failed to load users', err);
      Message.error(t('userManagement.errors.fetchUsers'));
    }
  }, [t]);

  const loadInvitations = useCallback(async () => {
    try {
      const data = await apiFetch<{ success: boolean; invitations: InvitationItem[] }>(
        'GET',
        '/api/auth/invitations'
      );
      setInvitations(data.invitations ?? []);
    } catch (err) {
      console.error('Failed to load invitations', err);
      Message.error(t('userManagement.errors.fetchUsers'));
    }
  }, [t]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'users') await loadUsers();
      else await loadInvitations();
    } finally {
      setLoading(false);
    }
  }, [tab, loadUsers, loadInvitations]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRoleChange = useCallback(
    async (userId: string, role: string) => {
      setActingId(userId);
      try {
        await apiFetch('POST', `/api/auth/users/${userId}/role`, { role });
        Message.success(t('userManagement.roleUpdated'));
        await loadUsers();
      } catch (err) {
        const e = err as ApiError;
        console.error('Failed to change role', e);
        Message.error(e.code === 'CONFLICT' ? t('userManagement.errors.roleUpdateFailed') : t('userManagement.errors.roleUpdateFailed'));
      } finally {
        setActingId(null);
      }
    },
    [t, loadUsers]
  );

  const handleToggleActive = useCallback(
    async (userId: string, active: boolean) => {
      setActingId(userId);
      try {
        const path = active ? `/api/auth/users/${userId}/enable` : `/api/auth/users/${userId}/disable`;
        await apiFetch('POST', path);
        Message.success(active ? t('userManagement.userEnabled') : t('userManagement.userDisabled'));
        await loadUsers();
      } catch (err) {
        const e = err as ApiError;
        console.error('Failed to toggle user', e);
        const msg =
          e.status === 400
            ? t('userManagement.errors.cannotDisableSelf')
            : e.code === 'CONFLICT'
              ? t('userManagement.errors.toggleFailed')
              : t('userManagement.errors.toggleFailed');
        Message.error(msg);
      } finally {
        setActingId(null);
      }
    },
    [t, loadUsers]
  );

  const handleResetPassword = useCallback(
    async (userId: string) => {
      setActingId(userId);
      try {
        await apiFetch('POST', `/api/auth/users/${userId}/reset-password`);
        Message.success(t('userManagement.passwordReset'));
      } catch (err) {
        const e = err as ApiError;
        console.error('Failed to reset password', e);
        Message.error(
          e.status === 400
            ? t('userManagement.errors.cannotResetSelf')
            : t('userManagement.errors.resetFailed')
        );
      } finally {
        setActingId(null);
      }
    },
    [t]
  );

  const handleCreateInvitation = useCallback(async () => {
    setActingId('__create__');
    try {
      const data = await apiFetch<{ success: boolean; code: string; expires_at: number }>(
        'POST',
        '/api/auth/invitations',
        { expires_in_days: expiryDays }
      );
      setCreatedCode(data.code);
      setCreatedExpiresAt(data.expires_at);
      Message.success(t('userManagement.invitationCreated'));
      await loadInvitations();
    } catch (err) {
      console.error('Failed to create invitation', err);
      Message.error(t('userManagement.errors.createInviteFailed'));
    } finally {
      setActingId(null);
    }
  }, [t, expiryDays, loadInvitations]);

  const handleRevoke = useCallback(
    async (code: string) => {
      setActingId(code);
      try {
        await apiFetch('DELETE', `/api/auth/invitations/${code}`);
        Message.success(t('userManagement.invitationCreated'));
        await loadInvitations();
      } catch (err) {
        console.error('Failed to revoke invitation', err);
        Message.error(t('userManagement.errors.toggleFailed'));
      } finally {
        setActingId(null);
      }
    },
    [t, loadInvitations]
  );

  const copyCode = useCallback((code: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(code)
        .then(() => Message.success(t('userManagement.copied')))
        .catch(() => {});
    }
  }, [t]);

  const invitationStatus = useCallback(
    (inv: InvitationItem): { label: string; tone: 'ok' | 'warn' | 'muted' } => {
      if (inv.used_by) return { label: t('userManagement.used'), tone: 'muted' };
      if (inv.expires_at < Date.now()) return { label: t('userManagement.expired'), tone: 'warn' };
      return { label: t('userManagement.active'), tone: 'ok' };
    },
    [t]
  );

  const usersTable = useMemo(
    () => (
      <table className='um-table'>
        <thead>
          <tr>
            <th>{t('userManagement.username')}</th>
            <th>{t('userManagement.role')}</th>
            <th>{t('userManagement.status')}</th>
            <th>{t('userManagement.lastLogin')}</th>
            <th>{t('userManagement.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.user_id}>
              <td>{u.username}</td>
              <td>
                <select
                  value={u.role}
                  disabled={actingId === u.user_id || u.user_id === myId}
                  onChange={(e) => void handleRoleChange(u.user_id, e.target.value)}
                  className='um-select'
                >
                  <option value='user'>{t('userManagement.user')}</option>
                  <option value='admin'>{t('userManagement.admin')}</option>
                </select>
              </td>
              <td>
                <span className={u.is_active ? 'um-badge um-badge-ok' : 'um-badge um-badge-warn'}>
                  {u.is_active ? t('userManagement.active') : t('userManagement.disabled')}
                </span>
              </td>
              <td>{formatTime(u.last_login)}</td>
              <td>
                {u.user_id === myId ? (
                  <span className='um-muted'>{t('userManagement.changeRole')}</span>
                ) : (
                  <span className='um-actions'>
                    <button
                      type='button'
                      className='um-btn'
                      disabled={actingId === u.user_id}
                      onClick={() => void handleToggleActive(u.user_id, !u.is_active)}
                    >
                      {u.is_active ? t('userManagement.disable') : t('userManagement.enable')}
                    </button>
                    <button
                      type='button'
                      className='um-btn'
                      disabled={actingId === u.user_id}
                      onClick={() => void handleResetPassword(u.user_id)}
                    >
                      {t('userManagement.resetPassword')}
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={5} className='um-empty'>
                —
              </td>
            </tr>
          )}
        </tbody>
      </table>
    ),
    [users, actingId, myId, t, handleRoleChange, handleToggleActive, handleResetPassword]
  );

  const invitationsPanel = useMemo(
    () => (
      <div className='um-inv'>
        <div className='um-inv-create'>
          <p className='um-desc'>{t('userManagement.createInvitationDesc')}</p>
          <div className='um-inv-create-row'>
            <label className='um-label'>{t('userManagement.expiresAt')}：</label>
            <input
              type='number'
              min={1}
              max={365}
              value={expiryDays}
              onChange={(e) => setExpiryDays(Math.max(1, Number(e.target.value) || 7))}
              className='um-input um-input-num'
            />
            <span className='um-muted'>{t('userManagement.days')}</span>
            <button
              type='button'
              className='um-btn um-btn-primary'
              disabled={actingId === '__create__'}
              onClick={() => void handleCreateInvitation()}
            >
              {t('userManagement.generate')}
            </button>
          </div>
          {createdCode && (
            <div className='um-code-box'>
              <div className='um-code'>{createdCode}</div>
              <div className='um-desc'>{t('userManagement.shareInviteLink')}</div>
              {createdExpiresAt && (
                <div className='um-muted'>
                  {t('userManagement.expiresAt')}：{formatTime(createdExpiresAt)}
                </div>
              )}
              <button type='button' className='um-btn' onClick={() => copyCode(createdCode)}>
                {t('userManagement.copied')}
              </button>
            </div>
          )}
        </div>

        <div className='um-inv-list'>
          {invitations.length === 0 ? (
            <div className='um-empty'>{t('userManagement.noInvitations')}</div>
          ) : (
            <table className='um-table'>
              <thead>
                <tr>
                  <th>{t('userManagement.invitations')}</th>
                  <th>{t('userManagement.username')}</th>
                  <th>{t('userManagement.expiresAt')}</th>
                  <th>{t('userManagement.status')}</th>
                  <th>{t('userManagement.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => {
                  const st = invitationStatus(inv);
                  return (
                    <tr key={inv.code}>
                      <td>
                        <code className='um-code-inline'>{inv.code}</code>
                      </td>
                      <td>{inv.created_by}</td>
                      <td>{formatTime(inv.expires_at)}</td>
                      <td>
                        <span
                          className={
                            st.tone === 'ok'
                              ? 'um-badge um-badge-ok'
                              : st.tone === 'warn'
                                ? 'um-badge um-badge-warn'
                                : 'um-badge um-badge-muted'
                          }
                        >
                          {st.label}
                        </span>
                      </td>
                      <td>
                        {!inv.used_by && inv.expires_at >= Date.now() ? (
                          <button
                            type='button'
                            className='um-btn um-btn-danger'
                            disabled={actingId === inv.code}
                            onClick={() => void handleRevoke(inv.code)}
                          >
                            {t('userManagement.revoke')}
                          </button>
                        ) : (
                          <span className='um-muted'>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    ),
    [invitations, expiryDays, actingId, createdCode, createdExpiresAt, t, handleCreateInvitation, handleRevoke, copyCode, invitationStatus]
  );

  if (!user) return null;
  if (user.role !== 'admin') return <Navigate to='/guid' replace />;

  return (
    <div className='um-page'>
      <div className='um-header'>
        <h1 className='um-title'>{t('userManagement.title')}</h1>
        <button type='button' className='um-btn' disabled={loading} onClick={() => void refresh()}>
          {t('userManagement.refresh')}
        </button>
      </div>

      <div className='um-tabs'>
        <button
          type='button'
          className={tab === 'users' ? 'um-tab um-tab-active' : 'um-tab'}
          onClick={() => setTab('users')}
        >
          {t('userManagement.usersList')}
        </button>
        <button
          type='button'
          className={tab === 'invitations' ? 'um-tab um-tab-active' : 'um-tab'}
          onClick={() => setTab('invitations')}
        >
          {t('userManagement.invitations')}
        </button>
      </div>

      <div className='um-body'>{tab === 'users' ? usersTable : invitationsPanel}</div>
    </div>
  );
};

export default UserManagementPage;
