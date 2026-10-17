import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../api';
import BrandMark from '../components/BrandMark';
import { useAuthStore } from '../auth-store';

const loginSchema = z.object({ email: z.string().email('请输入有效邮箱'), password: z.string().min(1, '请输入密码'), totpCode: z.string().max(100).optional() });
const REMEMBER_ACCOUNT_KEY = 'moheng:remember-account';
const REMEMBERED_EMAIL_KEY = 'moheng:remembered-email';
function readRememberedEmail() { try { return typeof window !== 'undefined' && window.localStorage.getItem(REMEMBER_ACCOUNT_KEY) === '1' ? window.localStorage.getItem(REMEMBERED_EMAIL_KEY) ?? '' : ''; } catch { return ''; } }
function readRememberAccountPreference() { try { return typeof window !== 'undefined' && window.localStorage.getItem(REMEMBER_ACCOUNT_KEY) === '1'; } catch { return false; } }
type LoginValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const setRestrictedSession = useAuthStore((state) => state.setRestrictedSession);
  const [submitError, setSubmitError] = useState('');
  const [rememberAccount, setRememberAccount] = useState(() => readRememberAccountPreference());
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: readRememberedEmail(), password: '', totpCode: '' } });

  const submit = handleSubmit(async (values) => {
    setSubmitError('');
    try {
      const result = await api.login(values.email, values.password, values.totpCode?.trim());
      if ('flow' in result) {
        setRestrictedSession(result.restrictedToken, result.user, result.flow);
        navigate('/account/security-step', { replace: true });
        return;
      }
      setSession(result.accessToken, result.user);
      try { if (rememberAccount) { window.localStorage.setItem(REMEMBER_ACCOUNT_KEY, '1'); window.localStorage.setItem(REMEMBERED_EMAIL_KEY, values.email.trim()); } else { window.localStorage.removeItem(REMEMBER_ACCOUNT_KEY); window.localStorage.removeItem(REMEMBERED_EMAIL_KEY); } } catch { /* Storage may be disabled by browser policy; login should still succeed. */ }
      navigate('/');
    } catch (error) { setSubmitError(error instanceof ApiError ? error.message : '登录失败，请检查服务是否已启动'); }
  });

  return <div className="login-screen">
    <div className="login-art-panel">
      <div className="login-brand"><BrandMark /><div><strong>墨衡</strong><span>ENGINEERING BUSINESS DESK</span></div></div>
      <div className="login-art-copy"><div className="login-overline"><span />施工项目经营管理平台</div><h1>让每一笔成本<br /><em>都有迹可循。</em></h1><p>从合同、目标成本到实际发生与进度回款，建立施工项目经营数据的统一视图。</p>
        <div className="login-feature-list"><div><CheckCircle2 size={17} /><span>合同与目标成本持续对照</span></div><div><CheckCircle2 size={17} /><span>关键金额变更保留审计记录</span></div><div><CheckCircle2 size={17} /><span>项目维度的数据访问控制</span></div></div>
      </div>
      <div className="login-art-footer"><span>CONSTRUCTION FINANCE WORKSPACE</span><span>01 / PROJECT CONTROL</span></div>
      <div className="art-grid art-grid-a" /><div className="art-grid art-grid-b" /><div className="art-line art-line-a" /><div className="art-line art-line-b" />
    </div>
    <div className="login-form-panel"><div className="login-form-wrap"><div className="login-mobile-brand"><BrandMark /><strong>墨衡</strong></div><div className="login-heading"><div className="login-symbol"><LockKeyhole size={19} /></div><h2>欢迎回来</h2><p>登录你的项目工作空间</p></div>
      <form className="login-form" onSubmit={submit} noValidate>
        <label>工作邮箱</label><div className={`input-with-icon ${errors.email ? 'input-invalid' : ''}`}><Mail size={17} /><input type="email" autoComplete="username" placeholder="name@company.com" {...register('email')} /></div>{errors.email && <span className="field-error">{errors.email.message}</span>}
        <label>登录密码</label><div className={`input-with-icon ${errors.password ? 'input-invalid' : ''}`}><LockKeyhole size={17} /><input type="password" autoComplete="current-password" placeholder="请输入密码" {...register('password')} /></div>{errors.password && <span className="field-error">{errors.password.message}</span>}
        <label>验证器验证码 / 恢复码 <small className="optional-label">（启用多因素认证时填写）</small></label><div className="input-with-icon"><ShieldCheck size={17} /><input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={100} placeholder="6 位验证码或一次性恢复码" {...register('totpCode')} /></div>
        <label className="login-remember-row"><input type="checkbox" checked={rememberAccount} onChange={(e) => { const checked = e.target.checked; setRememberAccount(checked); if (!checked) { try { window.localStorage.removeItem(REMEMBER_ACCOUNT_KEY); window.localStorage.removeItem(REMEMBERED_EMAIL_KEY); } catch { /* Ignore unavailable browser storage. */ } } }} /><span><strong>记住账号</strong><small>密码由浏览器密码管理器安全保存，可使用浏览器的保存密码/自动填充功能。</small></span></label>
        {submitError && <div className="login-error">{submitError}</div>}
        <button className="button button-primary login-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? '正在验证…' : <>登录系统 <ArrowRight size={17} /></>}</button>
      </form>
      <div className="login-safety"><ShieldCheck size={16} /><span>安全会话验证 · 访问权限按项目控制</span></div>
      <div className="demo-credentials"><strong>首次登录</strong><span>请使用部署时配置的管理员账号。</span><small>若无法登录，请联系维护人员检查账号初始化状态。</small></div>
    </div><div className="login-copyright">© 2026 墨衡工程经营管理 · 内部业务系统</div></div>
  </div>;
}
