# UI 验收 · Hana 1.1.35

> 验收日期：2026-10-21  
> 源码基线：`eec9677`（global assistant lazy-load + composer focus）  
> 范围：`apps/web` 全部主要页面路由、Hana 设置工作区、桌面/窄屏、全局命令中心、全局成本助手弹窗。  
> 结论：本轮 UI 收口已完成并通过仓库内自动化门禁；真实模型 E2E、Univer 画布内部皮肤和逐页产品签认仍按“已知缺口”保留，不冒充完成。

## 1. 本轮结果

| 项目 | 结果 | 复验方式 |
| --- | --- | --- |
| Web TypeScript | **通过** | `npm run lint -w @cms/web` |
| Web 生产构建 | **通过** | `npm run build -w @cms/web`（仅 Vite chunk 体积警告） |
| UI 规范校验 | **75/75** | `node scripts/validate-ui-polish.mjs` |
| 浏览器视觉回归 | **26 路由，0 failure** | `npm run ui:visual` |
| WCAG 2 A/AA（axe） | **20 页面，0 violation** | `npm run ui:axe` |
| 命令面板 / 助手弹窗 axe | **0 violation** | overlay axe 专项脚本 |
| 桌面 1440×900 | 通过 | 26 路由 DOM/视觉回归 |
| 窄屏 733 / 390 | 全路由无页面级横向溢出 | 浏览器实测 |
| 账号表 713×827 | `scrollWidth - clientWidth = 0` | 卡片行实测 |
| 助手弹窗 733 / 390 | 横向溢出 0 | 三栏/抽屉实测 |

说明：浏览器视觉回归统计的是页面路由；设置抽屉、命令面板、助手弹窗、表格行 focus/hover 和窄屏卡片行由专项 Playwright 检查覆盖。截图保存在本地忽略目录 `.ui-review/`，不提交仓库。

## 2. 设计 token 与交互收口

### 2.1 交互半径

- 控件：`--radius-control` = `6 × 1.8409 ≈ 11.05px`
- 按钮/导航：`--radius-action` = `5 × 1.8409 ≈ 9.20px`
- 行内小操作：`--radius-compact` = `4 × 1.8409 ≈ 7.36px`
- 卡片：`--radius-card` = `8 × 1.8409 ≈ 14.73px`

输入框、下拉、搜索壳、日期触发器、文本域统一 `corner-shape: round`；按钮、关闭键、导航统一 action token。禁止页面继续写 2/3/5/7/8/10/12px 的交互圆角。

### 2.2 状态 token

- `--state-hover-bg`：4% 墨色 hover
- `--state-hover-bg-strong`：7% 墨色紧凑 hover
- `--state-selected-bg`：7% accent
- `--state-selected-border`：18% accent
- `--state-focus-bg`：4% accent
- `--state-focus-ring`：52% accent
- `--state-disabled-opacity`：0.48

表格行/列表项/命令项/助手会话行共用；hover 不再改变 padding、不再画 bronze 首列竖条；键盘焦点改为 1px 内缩 accent ring，不再整行铺重色。

### 2.3 卡片 inset

- `--card-inset: var(--space-16)`，卡片正文、汇总格、提示条、列表行、空态至少 16px 横向内缩。
- 修复 v6 `:first-child { padding-left: 0 }` 在无外层 padding 的汇总 grid 上造成的首格贴边。
- 报表明细、变更汇总、待办汇总、账号行卡、合同金额格、驾驶舱入口均按 16px 检查。
- 报表目录、待办行、设置行等列表分隔线统一 1px、左右 16px 内缩；不再同时保留 `border-bottom` 和 `::before`。

## 3. 页面与组件

- **报表中心**：修复报表目录双横线；选中态使用状态 token。
- **待办与预警**：行线内缩、汇总首格 16px、筛选组带数量、行 hover token。
- **项目驾驶舱**：单张“身份 + 四指标 + 健康条”主卡；带真实数据的六入口；无月度成本时不画空坐标轴。
- **主合同**：金额口径并入 hero；删除重复编辑入口；删除与顶部 tab 重复的底部“关联业务”。
- **变更签证**：卡片/提示/空态 16px inset；汇总首格不再贴边。
- **账号管理**：≤900px 使用带 `data-label` 的卡片行，消除 713px 横向滚动；行 focus/hover 使用统一 token。
- **全局命令中心**：760px；搜索框 + 全部/页面/项目 scope；分组结果；`aria-activedescendant` 与键盘操作。
- **全局成本助手**：标题栏快捷操作旁按钮；三栏弹窗（会话 / 对话 / 依据）；底部悬浮 composer；≤1120px 依据抽屉；≤760px 全屏与横向会话条；按需加载独立 chunk。

## 4. 路由与助手

- 成本助手不再是 `/cost/assistant` 工作台页面，也不在成本工作台 tab 中。
- 旧 `/assistant` 打开全局弹窗后 replace 到 `/`；旧 `/cost/assistant` replace 到 `/cost`。
- 弹窗使用 `role="dialog"`、`aria-modal`、`data-focus-trap="modal"`；Esc/遮罩/关闭均关闭并恢复触发按钮焦点；首屏加载完成后 composer 自动聚焦。
- 助手未启用时标题栏不显示入口；直接打开旧链接时弹窗显示现有“未启用/配置不完整”状态。

## 5. 已知缺口

1. **真实模型 E2E**：本轮验证了助手弹窗布局、会话空态、打开/关闭、焦点恢复、深链接和响应式，没有调用真实供应商生成对话；流式消息、工具来源、取消/重连仍需在具备模型凭据的环境验收。
2. **Univer 画布**：ReportStudio/ReportDesigner 内部仍由 Univer 自身渲染；只统一外框、工具条、页头和按钮，不能用全局 CSS 穿透画布。
3. **逐页产品签认**：26 条主要路由通过浏览器回归，但产品/业务负责人逐页视觉签认仍是发布前事项；未签认页面不能标记为“用户已满意”。
4. **截图证据**：截图和专项脚本保存在本地忽略目录 `.ui-review/`，仓库只保留可复现验证脚本，不提交本机产物。

## 6. 复验命令

```bash
npm run lint -w @cms/web
npm run build -w @cms/web
node scripts/validate-ui-polish.mjs
npm run ui:visual
npm run ui:axe
```

浏览器脚本默认查找 Chrome；本机其他 Chromium 路径可通过 `CHROME_PATH` 指定。`ui:visual` / `ui:axe` 需要可登录的本地 API 与 Web 开发服务，并使用测试管理员账号；不要在生产库运行。

## 7. 相关文档

- [设计系统 Hana](设计系统-hana.md) — 当前唯一界面规范与 token。
- [Hana 交互组件对照](Hana交互组件对照.md) — 实测尺寸和落地状态。
- [AI 助手实施与准入](AI助手实施与准入.md) — 运行时、只读工具与安全边界。
- [文档总索引](INDEX.md) — 全部当前/归档文档入口。
