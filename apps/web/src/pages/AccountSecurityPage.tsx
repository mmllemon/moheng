import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { KeyRound, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { api, ApiError } from '../api';
import { useAuthStore } from '../auth-store';
import { Button, ErrorBlock, LoadingBlock, PageHeader } from '../components/Ui';

export default function AccountSecurityPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const clearSession = useAuthStore((state) => state.clearSession);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const meQuery = useQuery({ queryKey: ['account-me'], queryFn: () => api.get<{ id: string; name: string; email: string; role: 'ADMIN' | 'USER'; mfaEnabled: boolean; passwordResetRequired: boolean }>('/auth/me') });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setNotice('');
    if (newPassword.length < 12) { setError('新密码至少需要 12 位'); return; }
    if (newPassword !== confirmPassword) { setError('两次输入的新密码不一致'); return; }
    if (newPassword === currentPassword) { setError('新密码不能与当前密码相同'); return; }
    setBusy(true);
    try {
      await api.post<{ changed: boolean; mustLoginAgain: boolean; sessionsRevoked: boolean }>('/auth/password/change-self', { currentPassword, newPassword, ...(totpCode.trim() ? { totpCode: totpCode.trim() } : {}) });
      setNotice('密码已修改，其他设备上的登录会话也已撤销。请使用新密码重新登录。');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setTotpCode('');
      // Keep the success message visible briefly; the server has already revoked
      // every session, so no protected API action can succeed during this notice.
      window.setTimeout(() => { clearSession(); navigate('/login', { replace: true }); }, 1200);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '密码修改失败，请稍后重试');
    } finally { setBusy(false); }
  }

  if (meQuery.isLoading) return <div className="page-wrap"><LoadingBlock label="正在检查账号安全状态…" /></div>;
  if (meQuery.error || !meQuery.data) return <div className="page-wrap"><PageHeader eyebrow="ACCOUNT / SECURITY" title="个人中心与账号安全" subtitle="加载账号安全状态失败时，不会显示可能遗漏 MFA 要求的修改表单。" /><ErrorBlock message={(meQuery.error as Error | null)?.message ?? '无法读取当前账号安全状态'} retry={() => void meQuery.refetch()} /></div>;

  return <div className="page-wrap account-security-page">
    <PageHeader eyebrow="ACCOUNT / SECURITY" title="个人中心与账号安全" subtitle="维护自己的登录凭据。修改密码后，当前设备和其他设备的已有会话都会失效，需要重新登录。" />
    <section className="account-security-summary panel">
      <span className="account-security-avatar"><UserRound size={21} /></span>
      <div className="account-security-identity"><strong>{user?.name ?? '当前用户'}</strong><span>{user?.email ?? '—'}</span></div>
      <span className="account-security-role">{user?.role === 'ADMIN' ? '系统管理员' : '普通成员'}</span>
    </section>

    {notice && <div className="success-notice" role="status"><ShieldCheck size={16} />{notice}</div>}
    {error && <div className="form-alert" role="alert">{error}</div>}

    <section className="panel account-password-panel">
      <div className="panel-heading"><div><h3><KeyRound size={17} />修改登录密码</h3><p>必须验证当前密码；新密码最少 12 位。不要重复使用其他网站的密码。</p></div><span className="panel-icon"><ShieldCheck size={18} /></span></div>
      <form className="form-stack account-password-form" onSubmit={(event) => void submit(event)}>
        <div className="field"><label htmlFor="current-password">当前密码 <b>*</b></label><input id="current-password" required type="password" autoComplete="current-password" maxLength={200} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
        <div className="field"><label htmlFor="new-password">新密码 <b>*</b></label><input id="new-password" required type="password" autoComplete="new-password" minLength={12} maxLength={200} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><small className="field-hint">建议使用密码管理器生成的唯一密码。</small></div>
        <div className="field"><label htmlFor="confirm-password">确认新密码 <b>*</b></label><input id="confirm-password" required type="password" autoComplete="new-password" minLength={12} maxLength={200} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div>
        {meQuery.data?.mfaEnabled && <div className="field"><label htmlFor="password-change-mfa">多因素认证验证码或恢复码 <b>*</b></label><input id="password-change-mfa" required autoComplete="one-time-code" maxLength={100} value={totpCode} onChange={(event) => setTotpCode(event.target.value)} placeholder="6 位验证码或一次性恢复码" /><small className="field-hint">已启用 MFA 的账号必须使用一个尚未使用过的验证码或恢复码确认本次操作。</small></div>}
        <div><Button type="submit" disabled={busy || meQuery.isLoading || !currentPassword || newPassword.length < 12 || !confirmPassword || Boolean(meQuery.data?.mfaEnabled && !totpCode.trim())}><KeyRound size={15} />{busy ? '正在更新…' : '确认修改密码'}</Button></div>
      </form>
    </section>

    <section className="panel account-session-note">
      <div className="account-session-note-icon"><LogOut size={18} /></div>
      <div><strong>修改密码后会发生什么？</strong><p>服务端会撤销该账号所有有效会话和刷新令牌，并写入操作审计及安全事件。启用了 MFA 的账号还需通过一次新的验证器验证码或恢复码。当前版本的自助找回密码邮件流程尚未开放。</p></div>
    </section>
  </div>;
}
