# SettingsSection 组件（Hana 源码级复刻）

> 首个从 Hana 源码级对齐的组件。建立日期：2026-10-23。

## 1. 为什么这个文档重要

前几轮我多次基于「类名相似」或「局部 CSS 片段」猜测 Hana 规格，几乎每次都猜错：

| 我的猜测 | 实际值 | 错因 |
|---|---|---|
| 分区标题 17px | 14.4px | 抄了过期的设计文档 |
| 分区标题用宋体 | 无衬线（继承） | 把一个特例当通则 |
| 分区标题 11.2px 灰色大写 | 14.4px 主墨色 | 查到的是导航分组标签 |

**这个组件是第一次拿到确定答案**，因为溯源到了 Hana 的 JS 源码。

## 2. 溯源链路

```
import { J as ae } from "./AnimationPrimitives-O85oXpjE.js"
   ↓  J 是导出别名
export { ..., zP as J, ... }
   ↓  zP 是 Object.assign 的结果
const zP = Object.assign(PM, { Card: CM, Footer: MM, Note: TM, SubBlock: kM, Warning: EM })
   ↓  PM 是组件本体
function PM({ title, description, context, variant = "default", surface, children, className })
```

关键发现：**`ae` 不在 `SettingsModalShell` 里，而是从 `AnimationPrimitives` 导入的。**
之前一直在这个 497KB 的文件里找，所以没找到。

## 3. Hana 原始实现（逐字）

```js
function PM({ title, description, context, variant = "default", surface, children, className }) {
  const id = useId();
  const titleId = title ? `${id}-title` : undefined;
  const descId = description ? `${id}-description` : undefined;
  // surface 由 variant 推导
  const s = surface ?? (variant === "hero" || variant === "double-column" ? "plain" : "card");

  const sectionClass = [
    U.section,
    variant === "hero" && U.sectionHero,
    variant === "double-column" && U.sectionDoubleColumn,
    s === "plain" && U.sectionPlain,
    variant === "list" && U.sectionList,
    className,
  ].filter(Boolean).join(" ");

  const showHeader = (title || context) && variant !== "hero";
  const headerClass = [U.sectionHeader, description && U.sectionHeaderWithDescription].filter(Boolean).join(" ");

  return (
    <section className={sectionClass} aria-labelledby={titleId} aria-describedby={descId}>
      {showHeader && (
        <div className={headerClass}>
          {title && <h2 id={titleId} className={U.sectionTitle}>{title}</h2>}
          {context && <div className={U.sectionContext}>{context}</div>}
        </div>
      )}
      {description && <div id={descId} className={U.sectionDescription}>{description}</div>}
      <Jm variant={s} className={U.sectionBody}>{children}</Jm>
    </section>
  );
}

// surface 包装层
function Jm({ variant = "card", className, children, ...rest }) {
  return (
    <div className={[U.surface, variant === "card" ? U.surfaceCard : U.surfacePlain, className]}
         data-settings-surface={variant}>
      {children}
    </div>
  );
}

// 五个子组件
function CM({ children, className, ...rest }) { return <Jm className={className} {...rest}>{children}</Jm>; }  // Card
function MM({ children }) { return <div className={U.sectionFooter}>{children}</div>; }                          // Footer
function TM({ children, className, ...rest }) { return <div className={[U.sectionNote, className]}>{children}</div>; }  // Note
function kM({ title, children }) { return <div className={U.subBlock}>{title && <h3>{title}</h3>}{children}</div>; }     // SubBlock
function EM({ children, className, ...rest }) { return <div className={[U.sectionWarning, className]}>{children}</div>; } // Warning
```

## 4. CSS 真值（AnimationPrimitives-alJC4Pbo.css 原文）

```css
/* 分区容器 */
._section_b489b                    { margin-bottom: var(--space-40); }

/* 标题行 */
._sectionHeader_a7886              { display: flex; flex-wrap: wrap; align-items: center;
                                     justify-content: space-between; gap: var(--space-16);
                                     margin-bottom: var(--space-12); }
._sectionHeaderWithDescription_2b236 { margin-bottom: var(--space-4); }

/* 标题 */
._sectionTitle_f4979               { margin: 0; padding-inline-start: var(--settings-heading-inset, 0);
                                     color: var(--text); font-size: var(--fs-body); font-weight: 600;
                                     letter-spacing: 0; }

/* 上下文（标题右侧） */
._sectionContext_93eb0             { flex-shrink: 0; }

/* 说明 */
._sectionDescription_8c542         { margin: 0 0 var(--space-16);
                                     padding-inline-start: var(--settings-heading-inset, 0);
                                     color: var(--text-muted); font-size: var(--fs-caption);
                                     line-height: 1.5; }

/* 正文 */
._sectionBody_5c316                { display: flex; flex-direction: column; }

/* surface 层 */
._surface_759ae                    { width: 100%; min-width: 0; }
._surfaceCard_86326                { display: flex; flex-direction: column;
                                     border: var(--settings-outline-width, var(--border-width, 1px)) solid
                                             var(--settings-card-border, var(--border));
                                     border-radius: calc(var(--settings-surface-radius, var(--radius-card, 8px))
                                                         * var(--corner-radius-scale, 1));
                                     corner-shape: squircle; background: var(--bg-card); }
._surfacePlain_dedfd               { background: none; border: none; border-radius: 0; }

/* 变体 */
._sectionHero_c64e4                { padding: var(--space-40) var(--space-16); text-align: center; }
._sectionList_03dac > body > *     { padding: var(--space-6) var(--space-12);
                                     transition: background var(--duration-fast); }
._sectionList_03dac > body > *:hover { background: var(--overlay-light); }
._sectionPlain_d88bd > body > *    { padding-left: 0; padding-right: 0; }

/* 子组件 */
._sectionFooter_1de1e              { display: flex; justify-content: flex-end;
                                     padding: var(--space-8) var(--space-16);
                                     border-top: 1px solid var(--settings-divider, var(--border)); }
._sectionNote_ac852                { padding: var(--space-8) var(--space-16);
                                     color: var(--text-muted); font-size: var(--fs-hint); line-height: 1.4; }
._sectionWarning_861b4             { padding: var(--space-8) var(--space-16);
                                     color: var(--danger, #b56b66); font-size: var(--fs-caption); line-height: 1.5; }
._subBlock_27d05                   { margin-bottom: var(--space-16); }
._subBlockTitle_32dd6              { margin: 0 0 var(--space-8) 0; color: var(--text-light);
                                     font-size: var(--fs-body); font-weight: 600; }
```

## 5. moheng 实现中的一处必要修正

Hana 原式：

```css
border-radius: calc(var(--settings-surface-radius, var(--radius-card, 8px)) * var(--corner-radius-scale, 1));
```

**不能直接照抄。** 因为两边的 `--radius-card` 语义不同：

| | `--radius-card` 的值 | 是否已含 squircle 系数 |
|---|---|---|
| Hana | `8px` | ❌ 不含，需在 calc 里乘 |
| moheng | `calc(8px * 1.8409) = 14.73px` | ✅ 已含 |

照抄会变成 `14.73 × 1.8409 = 27.11px`（重复缩放）。

**moheng 实现改为：**

```css
border-radius: var(--settings-surface-radius, var(--radius-card));
```

实测结果：**14.7272px**，与 moheng 其他卡片一致。

## 6. 已替换的位置

| 文件 | 原结构 | 现结构 |
|---|---|---|
| `AppearanceSettingsPage.tsx` | 3 个 `.settings-section` + `.settings-card` | 3 个 `<SettingsSection>` + `<SettingsSectionCard>` |
| `AccountSecurityPage.tsx` | 3 个 `.settings-section` + `.settings-card` | 3 个 `<SettingsSection>` + 原生 card/form |

替换后 `.settings-section` 残留数：**0**。

## 7. 实测对照

| 项 | Hana 真值 | moheng 实测 | 结果 |
|---|---|---|---|
| section margin-bottom | 40px | 40px | ✅ |
| header margin-bottom | 12px（无说明）/ 4px（有说明） | 12px | ✅ |
| header display | flex | flex | ✅ |
| title font-size | 14.4px | 14.4px | ✅ |
| title font-weight | 600 | 600 | ✅ |
| title color | `--text` | rgb(59,61,63) | ✅ |
| surface background | `--bg-card` | rgb(252,250,245) | ✅ |
| surface border | 1px | 1px solid | ✅ |
| surface radius | `--radius-card` | 14.7272px | ✅ |
| corner-shape | squircle | superellipse(2) | ✅ |
| h2 id 自动生成 | 是 | 是（`:r7:-title`） | ✅ |

## 8. 门禁同步更新

`validate-ui-polish.mjs` 中有一条断言硬编码了旧类名：

```js
// 旧
accountSecurity.includes('settings-section') && accountSecurity.includes('settings-card')
// 新
accountSecurity.includes('SettingsSection') && accountSecurity.includes('account-security-summary')
```

**这是必须改的**：断言验证的结构已经不存在了。保留旧断言会让检查失去意义。

## 9. 未完成

1. **其他设置页尚未替换**。`SystemManagementPage` 等页面用的是 `.settings-section`，但那是另一个文件（不在本次 2 个文件范围内）。
2. **`variant` 变体未实测**。`hero` / `list` / `double-column` / `surface="plain"` 已实现但未在真实页面验证。
3. **`CardShell` 尚未使用**。`CardShell.tsx` 已建好（CSS Modules 版），但页面的 `.panel` 还在用旧机制。
