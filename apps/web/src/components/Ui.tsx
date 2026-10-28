import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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

export function PageHeader({ title: _title, subtitle, context, actions }: { title: string; subtitle?: string; context?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  /* 对齐 hana 的页面骨架：会话窗口没有页面级大标题，
     当前上下文由顶栏的会话标题层承担（对应 moheng 顶栏的页面名）。

     长说明的处理（2026-10-23 改）：
     hana 的顶栏只放短状态标记（工作区名、记忆开关），不放段落说明。
     moheng 的 subtitle 是 30-86 字的业务口径说明，塞进顶栏会撑满整行、
     挤压右侧图标。因此不再作为文本显示，改为标题的悬停提示（title 属性）。 */
  useEffect(() => {
    const titleEl = document.querySelector('[data-page-title]');
    if (!titleEl) return;
    if (subtitle) titleEl.setAttribute('title', subtitle);
    else titleEl.removeAttribute('title');
    return () => { titleEl.removeAttribute('title'); };
  }, [subtitle]);

  /* 设置窗内：页面级操作按钮注入 .settings-titlebar 的操作区。
     设置窗已有自己的标题栏（显示当前页名），页内再出一行
     只有按钮的 page-header 会白占 30px + 22px 间距，
     且按钮位置与标题栏脱节（实测按钮 top 83、标题栏 top 31）。
     hana 的 ._titlebar_7cee1 就是三段：[标题][页面级操作][关闭]。
     用 effect 等 Layout 的 DOM 挂载后再取 slot，
     不能在同一次提交里同步查。 */
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(document.getElementById('settings-titlebar-actions'));
  }, []);

  if (!actions) return null;
  if (slot) return createPortal(<>{actions}</>, slot);
  return <div className="page-header">
    <div className="page-actions">{actions}</div>
  </div>;
}

/* Button：对齐 hana 的 ._btn_06f79 体系
   ---------------------------------------------------------
   hana 的结构：
     基类 ._btn_06f79        inline-flex / gap .4em / border 1px transparent
                             radius: control-radius × scale / squircle
                             min-height: control-height
     变体 ._variant-primary  accent 底 + on-accent 字
          ._variant-secondary overlay-subtle 底 + text 字
          ._variant-ghost    transparent + text-muted 字
          ._variant-danger   danger-bg 底 + on-accent 字
     尺寸 ._size-sm/md/lg/compact  只改 padding + font-size
     图标 ._button_7e46c     28×28 / padding 0 / border 3px transparent
                             background-clip padding-box

   moheng 原来只有 variant + size(sm|md)，缺三样：
     · 图标按钮形态（size="icon"）
     · lg 档（页头主操作、对话框提交）
     · 属性透传（aria-label / title / data-* / ref）
   而实际页面里 34 处 .icon-button 都带 aria-label，
   6 处 .panel-header-action 需要 data-* 标记，
   不补透传就无法迁移。 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm' | 'compact' | 'header' | 'toolbar';

export function Button({
  children, onClick, variant = 'primary', type = 'button', disabled = false,
  size = 'md', className = '', ...rest
}: {
  children: ReactNode;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  variant?: ButtonVariant;
  type?: 'button' | 'submit';
  disabled?: boolean;
  size?: ButtonSize;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type' | 'disabled' | 'className' | 'children'>) {
  /* 尺寸类映射：
       xs      -> button-xs（表格行内、24px / pad 0 6）
       header  -> button-header（面板卡头操作、24px / pad 0 8）
       sm      -> button-small（26px）
       md      -> 默认（32px）
       lg      -> button-lg（32px 高、宽 padding）
       icon    -> button-icon（方形 28×28）
       icon-sm -> button-icon-sm（密集图标 22×22，树行/表行内）
       toolbar -> button-toolbar（图标+文字 20px，工具栏标签式）
       compact -> button-compact（32px 高、紧凑 padding） */
  const sizeCls = size === 'xs' ? 'button-xs'
    : size === 'header' ? 'button-header'
    : size === 'sm' ? 'button-small'
    : size === 'lg' ? 'button-lg'
    : size === 'icon' ? 'button-icon'
    : size === 'icon-sm' ? 'button-icon-sm'
    : size === 'toolbar' ? 'button-toolbar'
    : size === 'compact' ? 'button-compact'
    : '';
  return <button
    {...rest}
    className={`button button-${variant} ${sizeCls} ${className}`.trim().replace(/\s+/g, ' ')}
    type={type}
    onClick={onClick}
    disabled={disabled}
  >{children}</button>;
}

/* Metrics：指标区。把「标签 + 数值 + 说明」的三段式收成一个数据驱动的组件。

   背景：同样的结构在 12+ 个页面里手写了 104 处，各自挂自己的类名
   （bill-summary / change-summary / owner-metric / ldg-stats / an-stats…），
   CSS 侧累计 28 个类、约 500 条规则做同一件事。

   视觉对齐 hana 的 ._metrics_2473c / ._metric_53489：
     容器：grid + gap 16px，无 border / 无 background
     子项：flex column，无卡片
   业务页比 hana 的设置面板宽（1292 vs 620），所以子项之间加 1px 竖线。 */
export type MetricItem = {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  /** danger 会把数值标红（成本余量为负这类） */
  tone?: 'default' | 'danger';
};

export function Metrics({ items, columns = 4, className = '' }: {
  items: MetricItem[];
  columns?: number;
  className?: string;
}) {
  return <div className={`metrics ${className}`.trim()} data-cols={columns}>
    {items.map((m, i) => (
      <div className="metric" key={i}>
        <span>{m.label}</span>
        <strong className={m.tone === 'danger' ? 'text-danger' : undefined}>{m.value}</strong>
        {m.detail != null && <small>{m.detail}</small>}
      </div>
    ))}
  </div>;
}

const statusText: Record<string, string> = {
  CONSTRUCTION: '施工中', SETTLEMENT_PENDING: '待结算', SETTLED: '已结算', PAUSED: '已暂停', ADMIN: '系统管理员', USER: '普通账号', PLANNED: '规划中', PENDING: '待验收',
  ACTIVE: '有效/正常', INACTIVE: '停用', DEFAULT: '内置默认', RUNNING: '执行中', SUCCEEDED: '成功', CANCELLED: '已取消', FAILED: '失败', MFA_ENABLED: 'MFA 已启用', DRAFT: '草稿', SUBMITTED: '已提交', UNDER_REVIEW: '审核中', APPROVED: '审批通过', PAID: '已到账', REJECTED: '已驳回', CONFIRMED: '内部审批通过', OPEN: '未收款', PARTIALLY_RECEIVED: '部分收款', RECEIVED: '已收款', VOID: '已作废',
};
const statusClass: Record<string, string> = {
  CONSTRUCTION: 'status-blue', SETTLEMENT_PENDING: 'status-orange', SETTLED: 'status-green', PAUSED: 'status-gray', ADMIN: 'status-blue', USER: 'status-gray', PLANNED: 'status-gray', PENDING: 'status-orange',
  ACTIVE: 'status-green', INACTIVE: 'status-gray', DEFAULT: 'status-blue', RUNNING: 'status-blue', SUCCEEDED: 'status-green', CANCELLED: 'status-gray', FAILED: 'status-red', MFA_ENABLED: 'status-green', DRAFT: 'status-gray', SUBMITTED: 'status-blue', UNDER_REVIEW: 'status-orange', APPROVED: 'status-green', PAID: 'status-green', REJECTED: 'status-red', CONFIRMED: 'status-green', OPEN: 'status-orange', PARTIALLY_RECEIVED: 'status-blue', RECEIVED: 'status-green', VOID: 'status-gray',
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


/**
 * 设置窗标题栏的页面级操作插槽。
 *
 * 对齐 hana ._titlebar_7cee1 的 space-between 三段结构：
 *   [标题] [页面级操作] [关闭]
 *
 * 页面把自己的操作（刷新、导出等）portal 到 Layout 预留的
 * #settings-titlebar-actions 容器里，这样按钮留在标题栏内，
 * 不会额外占一行，也不形成第二层固定栏。
 *
 * 容器不存在时（比如非设置页）静默不渲染。
 */
export function TitlebarActions({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.getElementById('settings-titlebar-actions'));
  }, []);

  return host ? createPortal(children, host) : null;
}
