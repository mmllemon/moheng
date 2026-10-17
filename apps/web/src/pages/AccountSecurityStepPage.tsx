import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { CheckCircle2, Clipboard, KeyRound, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../api';
import { useAuthStore } from '../auth-store';
import BrandMark from '../components/BrandMark';

 type EnrollmentStart = { secret: string; otpauthUrl: string; issuer: string; account: string; periodSeconds: number };

export default function AccountSecurityStepPage() {
  const navigate = useNavigate();
  const flow = useAuthStore((state) => state.restrictedFlow);
  const token = useAuthStore((state) => state.accessToken);
  const user = useAuthStore((state) => state.user);
  const clearSession = useAuthStore((state) => state.clearSession);
  const [enrollment, setEnrollment] = useState<EnrollmentStart | null>(null);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!token || !flow) return <Navigate to="/login" replace />;

  async function startEnrollment() {
    setBusy(true); setError('');
    try { setEnrollment(await api.post<EnrollmentStart>('/auth/mfa/enroll/start', {})); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : '无法开始多因素认证设置'); }
    finally { setBusy(false); }
  }

  async function confirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api.post<{ enabled: boolean; recoveryCodes: string[]; warning: string }>('/auth/mfa/enroll/confirm', { code: code.trim() });
      setRecoveryCodes(result.recoveryCodes); setFinished(true);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : '验证失败，请重试'); }
    finally { setBusy(false); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (newPassword !== confirmPassword) { setError('两次输入的新密码不一致'); return; }
    if (newPassword.length < 12) { setError('新密码至少 12 位'); return; }
    setBusy(true);
    try { await api.post('/auth/password/change', { password: newPassword }); setFinished(true); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : '密码修改失败'); }
    finally { setBusy(false); }
  }

  async function copyRecoveryCodes() {
    try { await navigator.clipboard.writeText(recoveryCodes.join('\n')); setCopied(true); }
    catch { setError('浏览器未允许剪贴板访问，请手动复制恢复码并安全保存'); }
  }

  function returnToLogin() { clearSession(); navigate('/login', { replace: true }); }

  return <div className="auth-step-screen">
    <div className="auth-step-card">
      <div className="auth-step-brand"><BrandMark /><div><strong>墨衡</strong><span>ACCOUNT SECURITY</span></div></div>
      {flow === 'password-change' ? <>
        <div className="auth-step-icon"><KeyRound size={22} /></div>
        <h1>{finished ? '密码已更新' : '设置新的登录密码'}</h1>
        <p className="auth-step-lead">{finished ? '为安全起见，当前临时凭证已失效。请使用新密码重新登录。' : `账号 ${user?.email ?? ''} 需要先完成密码更新才能继续。新密码至少 12 位。`}</p>
        {!finished && <form className="form-stack auth-step-form" onSubmit={changePassword}>
          <div className="field"><label>新密码 *</label><input type="password" autoComplete="new-password" minLength={12} maxLength={200} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></div>
          <div className="field"><label>确认新密码 *</label><input type="password" autoComplete="new-password" minLength={12} maxLength={200} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></div>
          {error && <div className="form-alert">{error}</div>}
          <button className="button button-primary" type="submit" disabled={busy}>{busy ? '正在更新…' : '更新密码'}</button>
        </form>}
        {finished && <button className="button button-primary" onClick={returnToLogin}>返回登录</button>}
      </> : <>
        <div className="auth-step-icon"><ShieldCheck size={22} /></div>
        <h1>{recoveryCodes.length ? '保存一次性恢复码' : '启用管理员多因素认证'}</h1>
        <p className="auth-step-lead">{recoveryCodes.length ? '恢复码只展示这一次。请分别保存到密码管理器或其他安全位置，任何人都不应通过聊天或邮件索取恢复码。' : '公网访问模式要求系统管理员启用 TOTP 验证器。可使用支持标准 TOTP 的身份验证器应用。'}</p>
        {!recoveryCodes.length && !enrollment && <button className="button button-primary" onClick={startEnrollment} disabled={busy}>{busy ? '正在生成配置…' : '生成验证器配置'}</button>}
        {!recoveryCodes.length && enrollment && <>
          <div className="auth-secret-panel"><span>账号</span><strong>{enrollment.account}</strong><span>手动输入密钥</span><code>{enrollment.secret}</code><small>如果验证器支持手动输入，请选择基于时间的一次性密码（TOTP），周期为 30 秒。</small><span>配置 URI（可复制到兼容的验证器）</span><textarea readOnly rows={3} value={enrollment.otpauthUrl} onFocus={(event) => event.currentTarget.select()} /></div>
          <form className="form-stack auth-step-form" onSubmit={confirmEnrollment}>
            <div className="field"><label>验证器中的 6 位验证码 *</label><input required inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" /></div>
            {error && <div className="form-alert">{error}</div>}
            <button className="button button-primary" type="submit" disabled={busy || code.length !== 6}>{busy ? '正在验证…' : '确认启用并生成恢复码'}</button>
          </form>
        </>}
        {recoveryCodes.length > 0 && <>
          <div className="recovery-code-grid">{recoveryCodes.map((value) => <code key={value}>{value}</code>)}</div>
          <button className="button button-secondary" onClick={copyRecoveryCodes}><Clipboard size={15} />{copied ? '已复制' : '复制恢复码'}</button>
          {error && <div className="form-alert">{error}</div>}
          <button className="button button-primary" onClick={returnToLogin}><CheckCircle2 size={16} />我已安全保存，返回登录</button>
        </>}
        {error && !recoveryCodes.length && <div className="form-alert">{error}</div>}
      </>}
      <div className="auth-step-footnote">安全提示：管理员多因素认证完成后，请重新登录。不会向服务器日志写入密码、验证码、原始恢复码或刷新令牌。</div>
    </div>
  </div>;
}
