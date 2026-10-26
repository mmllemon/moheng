import type { ReactNode } from 'react';
import styles from './CardShell.module.css';

type CardDensity = 'default' | 'dense' | 'flush';

type CardShellProps = {
  /** 卡片标题 */
  title?: ReactNode;
  /** 标题下方说明 */
  description?: ReactNode;
  /** 标题右侧操作位 */
  actions?: ReactNode;
  /** 内缩密度：default 16px / dense 14px / flush 无内缩无边框 */
  density?: CardDensity;
  className?: string;
  as?: 'section' | 'div' | 'article';
  children?: ReactNode;
};

/**
 * CardShell —— Hana 通用卡片壳的 1:1 实现（CSS Modules 版）。
 *
 * 溯源（Hana 1.1.35）：
 *   styles.css 定义 --panel-card-* 变量组：
 *     --panel-card-radius: var(--radius-lg)         （约 12px 裸值）
 *     --panel-card-border: 1px solid rgba(0,0,0,.08)
 *     --panel-card-bg:     var(--bg-card, var(--bg))
 *     --panel-card-shadow: none
 *
 *   通用卡片壳（CardShell.css ._previewPanelBody_11fea）使用：
 *     border-radius: calc(var(--panel-card-radius) * var(--corner-radius-scale, 1))
 *     corner-shape: squircle
 *     background: var(--panel-card-bg)
 *     border: var(--panel-card-border)
 *     box-shadow: var(--panel-card-shadow)
 *
 * 为什么用 CSS Modules（不是全局类）：
 *   Hana 原实现就是 CSS Modules（SettingsModalShell 575 个类中 562 个带 hash）。
 *   卡片是最基础的容器，样式若在全局命名空间，任何页面都能改到它。
 *
 * 与 Hana 的差异：
 *   - 不实现 -webkit-app-region: no-drag（Web 无窗口拖拽区）
 *   - 不实现 height:100% / overflow:auto（由使用方布局决定）
 */
export default function CardShell({
  title,
  description,
  actions,
  density = 'default',
  className,
  as: Tag = 'section',
  children,
}: CardShellProps) {
  const shellClass = [
    styles.shell,
    density === 'default' ? styles.padded : '',
    density === 'dense' ? styles.dense : '',
    density === 'flush' ? styles.flush : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const hasHeading = Boolean(title || actions);

  return (
    <Tag className={shellClass}>
      {hasHeading && (
        <div className={styles.heading}>
          <div className={styles.headingText}>
            {title && <h3 className={styles.title}>{title}</h3>}
            {description && <p className={styles.description}>{description}</p>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      )}
      <div className={styles.body}>{children}</div>
    </Tag>
  );
}

/** 卡内提示条 */
export function CardNotice({ children }: { children: ReactNode }) {
  return <div className={styles.notice}>{children}</div>;
}
