import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Plus, Search, type LucideIcon } from 'lucide-react';

export function Section({ title, subtitle, actions, icon: Icon, children, className = '' }: {
  title: string; subtitle?: string; actions?: ReactNode; icon?: LucideIcon; children: ReactNode; className?: string;
}) {
  return <section className={`ds-section ${className}`.trim()}>
    <div className="ds-section-head">
      <div className="ds-section-copy"><h2>{Icon && <Icon size={16} strokeWidth={1.6} />}{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      {actions && <div className="ds-section-actions">{actions}</div>}
    </div>
    <div className="ds-section-card">{children}</div>
  </section>;
}

export function SettingsSection({ title, description, actions, children, hidden = false, className = '' }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; hidden?: boolean; className?: string;
}) {
  return <section className={`settings-section ${className}`.trim()} hidden={hidden}>
    <div className="settings-section-head">
      <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
      {actions && <div className="settings-section-actions">{actions}</div>}
    </div>
    <div className="settings-section-card">{children}</div>
  </section>;
}

export function PageHeader({ title, subtitle, context, actions }: { title: string; subtitle?: string; context?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return <div className="page-header">
    <div><h1>{title}</h1>{context ? <div className="page-context">{context}</div> : subtitle && <p>{subtitle}</p>}</div>
    {actions && <div className="page-actions">{actions}</div>}
  </div>;
}

export function Button({ children, onClick, variant = 'primary', type = 'button', disabled = false, size = 'md', className = '' }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; type?: 'button' | 'submit'; disabled?: boolean; size?: 'sm' | 'md'; className?: string;
}) {
  return <button className={`button button-${variant} ${size === 'sm' ? 'button-small' : ''} ${className}`.trim()} type={type} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function MetricCard({ label, value, detail, trend, icon: Icon, tone = 'blue' }: {
  label: string; value: string; detail?: string; trend?: 'up' | 'down' | 'flat'; icon: LucideIcon; tone?: 'blue' | 'green' | 'orange' | 'purple';
}) {
  return <article className="metric-card">
    <div className="metric-top"><span>{label}</span><span className={`metric-icon tone-${tone}`}><Icon size={18} strokeWidth={1.8} /></span></div>
    <div className="metric-value">{value}</div>
    <div className="metric-bottom">{trend === 'up' && <ArrowUpRight size={14} className="trend-up" />}{trend === 'down' && <ArrowDownRight size={14} className="trend-down" />}{detail && <span>{detail}</span>}</div>
  </article>;
}

const statusText: Record<string, string> = {
  CONSTRUCTION: '施工中', SETTLEMENT_PENDING: '待结算', SETTLED: '已结算', PAUSED: '已暂停', ADMIN: '系统管理员', USER: '普通账号', PLANNED: '规划中', PENDING: '待验收',
  ACTIVE: '有效/正常', INACTIVE: '停用', DEFAULT: '内置默认', RUNNING: '执行中', CANCELLED: '已取消', FAILED: '失败', MFA_ENABLED: 'MFA 已启用', DRAFT: '草稿', SUBMITTED: '已提交', UNDER_REVIEW: '审核中', APPROVED: '审批通过', PAID: '已到账', REJECTED: '已驳回', CONFIRMED: '内部审批通过', OPEN: '未收款', PARTIALLY_RECEIVED: '部分收款', RECEIVED: '已收款', VOID: '已作废',
};
const statusClass: Record<string, string> = {
  CONSTRUCTION: 'status-blue', SETTLEMENT_PENDING: 'status-orange', SETTLED: 'status-green', PAUSED: 'status-gray', ADMIN: 'status-blue', USER: 'status-gray', PLANNED: 'status-gray', PENDING: 'status-orange',
  ACTIVE: 'status-green', INACTIVE: 'status-gray', DEFAULT: 'status-blue', RUNNING: 'status-blue', CANCELLED: 'status-gray', FAILED: 'status-red', MFA_ENABLED: 'status-green', DRAFT: 'status-gray', SUBMITTED: 'status-blue', UNDER_REVIEW: 'status-orange', APPROVED: 'status-green', PAID: 'status-green', REJECTED: 'status-red', CONFIRMED: 'status-green', OPEN: 'status-orange', PARTIALLY_RECEIVED: 'status-blue', RECEIVED: 'status-green', VOID: 'status-gray',
};
export function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge ${statusClass[status] ?? 'status-gray'}`}><span className="status-dot" />{statusText[status] ?? status}</span>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: () => void }) {
  return <div className="empty-state"><div className="empty-art"><Search size={24} /></div><h3>{title}</h3><p>{description}</p>{action && <Button onClick={action}><Plus size={15} />新建记录</Button>}</div>;
}

export function LoadingBlock({ label = '正在加载数据…' }: { label?: string }) {
  return <div className="loading-block"><span className="spinner" />{label}</div>;
}

export function ErrorBlock({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="error-block"><strong>数据暂时不可用</strong><p>{message}</p>{retry && <Button variant="secondary" onClick={retry}>重试</Button>}</div>;
}

export function formatMoney(value: number | null | undefined, digits = 2) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
}
export function formatWan(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  return `${(amount / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} 万`;
}
export function currentDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function currentDateTimeLocalInputValue(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Convert a date-only form value to a stable UTC-noon timestamp.
 * UTC noon avoids day drift in viewers across time zones while the API stores DateTime.
 */
export function dateInputToIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('日期格式无效，请使用 YYYY-MM-DD');
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) {
    throw new Error('日期无效');
  }
  return date.toISOString();
}

export function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }).format(date);
}
export function percentage(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1)}%`;
}
