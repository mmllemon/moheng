import type { ReactNode } from 'react';
import { useId } from 'react';
import styles from './SettingsSection.module.css';

type SectionVariant = 'default' | 'hero' | 'double-column' | 'list';
type SectionSurface = 'card' | 'plain';

type SettingsSectionProps = {
  /** 分区标题，渲染为 h2，与 aria-labelledby 关联 */
  title?: ReactNode;
  /** 分区说明，渲染在标题下方，与 aria-describedby 关联 */
  description?: ReactNode;
  /** 标题右侧的上下文内容（如操作按钮、状态标记） */
  context?: ReactNode;
  /** 变体：hero 无标题行、居中；list 行带 hover；double-column 默认 plain */
  variant?: SectionVariant;
  /** 覆盖 surface。未指定时由 variant 推导（hero/double-column → plain，其余 → card） */
  surface?: SectionSurface;
  className?: string;
  children?: ReactNode;
};

/**
 * SettingsSection —— Hana Section 组件的 1:1 实现。
 *
 * 溯源（Hana 1.1.35 源码）：
 *   function PM({ title, description, context, variant = 'default', surface, children, className })
 *   导出为 Object.assign(PM, { Card, Footer, Note, SubBlock, Warning })
 *
 * DOM 结构（与 Hana 完全一致）：
 *   <section aria-labelledby aria-describedby>
 *     <div class=header>              ← variant !== 'hero' 且有 title/context 时渲染
 *       <h2 class=title>
 *       <div class=context>
 *     </div>
 *     <div class=description>          ← 有 description 时渲染
 *     <div class=surface(surfaceCard|surfacePlain) class=body>   ← 实际是两层合并
 *       {children}                      ← 每个 Card 又是一层 surface
 *     </div>
 *   </section>
 *
 * 与 Hana 的一处实现差异（不影响 DOM）：
 *   Hana 把 body 和 surface 分成 <Jm variant><div class=body> 两层，
 *   这里合并为一层，因为 <Jm> 只做 surface 类名拼装，无其它逻辑。
 *   若后续需要严格对齐层次，可拆成两层，观感不变。
 */
export default function SettingsSection({
  title,
  description,
  context,
  variant = 'default',
  surface,
  className,
  children,
}: SettingsSectionProps) {
  const autoId = useId();
  const titleId = title ? `${autoId}-title` : undefined;
  const descriptionId = description ? `${autoId}-description` : undefined;

  /* Hana 的 surface 推导逻辑（源码）：
       surface ?? (variant === 'hero' || variant === 'double-column' ? 'plain' : 'card')

     但实测用法统计显示：settings 里 surface="plain" 用了 12 次，
     surface="card" 只用 2 次，Section.Card 只用 4 次。
     也就是说，Hana 绝大多数分区是「外层 plain + 内部 Card」——
     这样才能避免卡片套卡片。

     moheng 的默认改为 plain：传了 children 是 Card 时不嵌套，
     传的是裸内容时由 surface 提供卡片（需显式 surface="card"）。 */
  const resolvedSurface: SectionSurface =
    surface ?? (variant === 'hero' || variant === 'double-column' ? 'plain' : 'plain');

  const sectionClass = [
    styles.section,
    variant === 'hero' ? styles.hero : '',
    variant === 'list' ? styles.list : '',
    resolvedSurface === 'plain' ? styles.plain : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  // Hana 逻辑：hero 变体不渲染标题行
  const showHeader = Boolean(title || context) && variant !== 'hero';
  const headerClass = [styles.header, description ? styles.headerWithDescription : ''].filter(Boolean).join(' ');

  const surfaceClass = [styles.surface, resolvedSurface === 'card' ? styles.surfaceCard : styles.surfacePlain]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={sectionClass} aria-labelledby={titleId} aria-describedby={descriptionId}>
      {showHeader && (
        <div className={headerClass}>
          {title && (
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
          )}
          {context && <div className={styles.context}>{context}</div>}
        </div>
      )}
      {description && (
        <div id={descriptionId} className={styles.description}>
          {description}
        </div>
      )}
      <div className={[surfaceClass, styles.body].filter(Boolean).join(' ')}>{children}</div>
    </section>
  );
}

/** 分区内的卡片容器。Hana: Section.Card = <Jm variant="card">
 *
 * density：Hana 的 _surfaceCard 本身无 padding（内缩由内部元素负责）。
 * moheng 卡片内常有 table，需要卡片提供 padding，故加此参数：
 *   'default' 不加（同 Hana）
 *   'padded'  16px（--card-inset）
 *   'dense'   14px
 */
export function SettingsSectionCard({
  children,
  className,
  density = 'default',
}: {
  children?: ReactNode;
  className?: string;
  density?: 'default' | 'padded' | 'dense';
}) {
  return (
    <div
      className={[
        styles.surface,
        styles.surfaceCard,
        density === 'padded' ? styles.cardPadded : '',
        density === 'dense' ? styles.cardPaddedDense : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}

/** 页脚操作区。Hana: Section.Footer */
export function SettingsSectionFooter({ children }: { children?: ReactNode }) {
  return <div className={styles.footer}>{children}</div>;
}

/** 轻提示。Hana: Section.Note */
export function SettingsSectionNote({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={[styles.note, className].filter(Boolean).join(' ')}>{children}</div>;
}

/** 警示提示。Hana: Section.Warning */
export function SettingsSectionWarning({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={[styles.warning, className].filter(Boolean).join(' ')}>{children}</div>;
}

/** 子块，用于分区内再分层。Hana: Section.SubBlock */
export function SettingsSectionSubBlock({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={styles.subBlock}>
      {title && <h3 className={styles.subBlockTitle}>{title}</h3>}
      {children}
    </div>
  );
}

SettingsSection.Card = SettingsSectionCard;
SettingsSection.Footer = SettingsSectionFooter;
SettingsSection.Note = SettingsSectionNote;
SettingsSection.Warning = SettingsSectionWarning;
SettingsSection.SubBlock = SettingsSectionSubBlock;
