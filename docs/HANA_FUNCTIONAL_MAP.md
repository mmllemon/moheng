# HanaAgent 1.1.35-beta 功能地图（带注释静态分析）

> 来源：安装包 `HanaAgent-1.1.35-beta-Windows-x64.exe` → 安装目录 `resources/`
> 静态分析对象：
> - `hana-electron-shell/`（来自 `app.asar` 的 `desktop/` + `shared/`，已美化）
> - `hana-frontend-recovered/`（来自 `resources/seed/renderer-1.1.35-beta.tar.gz`，Vite 生产构建，已美化反压缩）
>
> ⚠️ 性质说明：所有结论均来自**静态代码观察**（AST 解析 + 字符串/字面量扫描），**未运行程序**。
> 变量名是构建期混淆名（如 `hL`、`xle`），无 source map，故组件/函数边界为推断。
> 这是"功能地图（feature map）"，不是源码还原。

---

## 0. 分层架构总览

```
┌─────────────────────────────────────────────────────────────┐
│  前端渲染层 (React 19 + Vite)  hana-frontend-recovered/       │
│   - 纯前端 SPA，跑在 Electron <webview>/BrowserView 中         │
│   - 通过 window.platform / window.hana 与外壳通信             │
└───────────────┬─────────────────────────────────────────────┘
                │  IPC / HTTP / WS（经 preload 桥接）
┌───────────────▼─────────────────────────────────────────────┐
│  Electron 外壳层 (主进程)   hana-electron-shell/              │
│   - bootstrap.cjs：启动校验、HANA_HOME 解析、辅助进程分发       │
│   - main.bundle.cjs：窗口管理、IPC 通道、自动更新、平台适配     │
│   - *.preload.bundle.cjs：contextBridge 暴露给前端的 API        │
└───────────────┬─────────────────────────────────────────────┘
                │  HTTP API + WebSocket  (端口由 server 提供)
┌───────────────▼─────────────────────────────────────────────┐
│  后端服务 (server-1.1.35，独立 Node 进程)   [尚未纳入本目录]    │
│   - 提供 /api/* 与 /ws，承载 Agent 核心逻辑                   │
└─────────────────────────────────────────────────────────────┘
```

**关键事实**：前端并非直接内联在 Electron 里编译，而是作为独立 Vite 构建产物（renderer tarball），
由外壳在窗口里加载。前端既可在 Electron 内运行，也可经 `modules/platform.js` 降级为纯 Web（HTTP API）。
这就是它同时有桌面端 + 移动端 + Web 端的原因。

---

## 1. Electron 外壳层功能地图

### 1.1 启动流程（`desktop/bootstrap.cjs`，**原始可读源码**）
职责：主进程加载前的"守门员"。

| 步骤 | 函数/调用 | 注释 |
|---|---|---|
| 注入 Windows 系统 CA | `enableWindowsSystemCaForCurrentProcess()` | 必须在创建任何 HTTPS 客户端前执行 |
| 应用 Office/PDF 辅助进程策略 | `applyOfficePdfHelperProcessPolicy(app)` | 限制辅助渲染进程权限 |
| 解析 HANA_HOME | `resolveLaunchHanakoHome({envValue, packaged})` | 开发态 `~/.hanako-dev`，打包态 `~/.hanako`；结果写入 `process.env.HANA_HOME` |
| 安装完整性校验（仅 Win 打包态） | `verifyWindowsInstallSurfaceBeforeMain()` / `launch-integrity.cjs` | 校验安装表面，失败弹错误框并退出 |
| 启动辅助进程 | `tryStartOfficePdfHelper()` / `tryStartCardScreenshotHelper()` | 若 argv 含 `--hana-office-html-to-pdf` 或 `--hana-card-screenshot` 则作为子进程运行 PDF/截图工具并退出，否则继续 |
| 加载主进程 | `loadDesktopMain()` | 打包态 `require("./main.bundle.cjs")`，开发态 `require("./main.cjs")` |
| 诊断日志 | `writeDiagnostic` / `appendLaunchLog` / `writeLaunchMarker` | 落到 `<HANA_HOME>/diagnostics/desktop-launch/`，上限 4MB 循环 |

> 结论：启动强调**安全**与**可诊断**——Windows 完整性校验、CA 注入、辅助进程隔离、详尽诊断日志。

### 1.2 主进程（`desktop/main.bundle.cjs`，混淆但已美化，29,551 行）
核心职责（从 IPC 通道 + 窗口加载模式推断）：

- **窗口生命周期管理**：`loadFile` / `loadURL` 加载各 HTML 入口；支持 data: URL 注入（用于一次性弹窗）。
- **App-Host 视图（核心架构）**：大量 `app-host-view-*` IPC 通道，表明存在一个"宿主视图"子系统——
  前端可通过它**向外壳请求创建/管理独立窗口**（detached card、app 宿主视图、标题栏带等）。
- **自动更新**：`package.json` 依赖含 `electron-updater`；`resources/app-update.yml` 为更新配置。
- **单实例 / 协议**：`bootstrap` 注释提到 second-instance 处理；支持 deep-link 式主窗口呈现 `app-window-host-view-present`。

### 1.3 IPC 通道清单（从 `main.bundle.cjs` 精确提取）

主进程注册的通道（全部以 `app-host-view-` 为主，少量 `app-window-`）：

```
app-host-view-bootstrap                  # 前端请求外壳初始化上下文
app-host-view-platform                  # 查询运行平台能力
app-host-view-create-session            # 创建会话
app-host-view-prepare-chat              # 准备聊天上下文
app-host-view-chat-action               # 聊天动作（发消息/取消等）
app-host-view-workspace-action          # 工作区操作
app-host-view-workspace-changed         # 工作区变更通知
app-host-view-window-control            # 窗口控制（关闭/最小化/最大化）
app-host-view-open-file / import-file / file-url   # 文件操作
app-host-view-select-folder             # 选择文件夹对话框
app-host-view-expand-window             # 展开窗口
app-host-view-detached-*                # 分离窗口：resize / raise / pin-mode / minimize / full-screen* / discard
app-host-view-card-create-detach-drag*  # 卡片拖拽分离（拖拽中 / 结束）
app-host-view-reserve-detached          # 预留分离窗口位
app-host-view-detach-feedback           # 分离反馈
app-host-view-titlebar-band-watch       # 标题栏带监听
app-host-view-result                    # 操作结果回传
app-host-view-pinned-registry:get/put-artifact  # 固定件注册表（读写）
app-window-host-view-present            # 呈现主窗口（被外部/协议激活时）
```

> 含义：前端几乎**不直接**调用底层 Electron API，而是经由 `app-host-view-*` 这一层"窗口编排协议"向主进程请求。
> 这让同一套前端可同时驱动桌面多窗口与 Web 端（Web 端无主进程，则走 HTTP 降级）。

### 1.4 Preload 桥接（`*.preload.bundle.cjs`，经 `contextBridge.exposeInMainWorld` 暴露）

暴露的全局对象（共 7 个）：

| 全局名 | 用途（推断） |
|---|---|
| `window.hana` | 主窗口桥接：文件读写、剪贴板图片、运行编辑命令、打开外部/文件夹、server 端口与 token |
| `window.hanaAppWindow` | App 窗口专属桥接 |
| `window.hanaHostView` | App-Host 视图桥接（与上面 IPC 通道对应） |
| `window.hanaAppReview` | 应用审查/评审窗口桥接 |
| `window.hanaTheme` | 主题桥接（读/写当前主题，配合 `data-theme` 属性） |
| `window.platform` | 平台抽象层（见下，由 `modules/platform.js` 在 renderer 内实现） |
| （另一 `hana` 变体） | 副本/分区窗口用 |

`window.hana` 暴露的方法（从 preload + 前端引用回推）：
`getServerPort`, `getServerToken`, `appReady`, `syncWindowTheme`, `readClipboardImage`,
`readFile`, `writeFile`, `runEditCommand`, `openExternal`, `showItemInFolder` …

---

## 2. 前端渲染层功能地图

### 2.1 入口与挂载
- `index.html` → 模块脚本 `assets/main-W25Ez4EQ.js` → `react-dom` `createRoot` + `StrictMode` 挂载 `<App>`。
- 挂载前先加载 `modules/platform.js`、`lib/i18n.js`、`lib/theme.js`（经典脚本，先于 React 执行）。
- `react` 版本：**19.x**（多个 `createRoot` 与 `StrictMode` 指纹）。

### 2.2 平台适配层（`modules/platform.js`，**原始可读源码，含中文注释**）
这是前端"可移植"的关键：

```
Electron 环境：window.hana 存在 → window.platform = window.hana（直接用 IPC 桥）
Web 环境：    降级为 HTTP API + 浏览器原生 API
              - 从 URL/localStorage 取 token，拼 baseUrl
              - readFile → fetch /api/fs/read，等等
```
所有前端代码统一调 `platform.xxx()`，**不直接碰 `window.hana`**。这使得同一份前端可跑在
桌面（Electron）、Web（HTTP）、移动端（PWA + service worker `sw.js`）。

### 2.3 子系统 / 组件识别（来自 Vite manifest + chunk 命名 + 字符串指纹）

| 子系统 | 入口 chunk | 说明 |
|---|---|---|
| 应用根壳 | `App-CfhKQJ81.js` / `AppUiSurface-*.{js,css}` | 顶层 App + UI 表面（含侧栏、主区、状态栏容器） |
| 聊天 | `ChatTranscript-BhjBc-kF.js` (1.5MB，最大 chunk) | 对话流渲染、消息气泡、流式输出 |
| 能力面板 | `CapabilitiesPanel-La2h94hS.js` | 模型/工具/能力展示与选择 |
| 卡片系统 | `CardShell-DVSoA_HL.js` (2.4MB) / `chalkboard/*` | "黑板(Chalkboard)"卡片：archive/face/registry 动作 |
| 设置 | `SettingsModalShell-DlzVJAiv.js` + `react/settings` | 设置弹窗（外观/模型/快速聊天等偏好） |
| 市场 | `MarketModalShell-D_AdINYY.js` | 插件/应用市场弹窗 |
| 移动端 | `MobileApp-BhyyXBor.*` / `react/mobile/*` | PWA 移动端 App + 移动卡片页 |
| 状态栏 | `StatusBar-DUvGVVTJ.js` | 底部状态栏 |
| 媒体 | `MediaSurface-O4mbWH31.js` / `MediaViewer.tsx` | 图片/视频/文件预览 |
| 计划模式 | `PlanModeButton-Dmkc8vS0.js` | 类"计划/确认"模式按钮 |
| 模型预设 | `provider-presets-CFsMlAsm.js` | 供应商/模型预设 |
| 主题注册表 | `theme-registry-BTJmVriA.js` | 主题注册与应用 |
| 动画 | `AnimationPrimitives-O85oXpjE.js` | 动画原语（motion 库封装） |
| 其它窗口 | `app-host-view / app-review / browser-viewer / pad / quick-chat / onboarding / mobile` HTML | 各自独立入口页 |

**声明在 Vite manifest 中的真实 TS 源路径（仅 14 个 entry，其余已并入 chunk）：**
```
react/chalkboard/card-archive-actions.ts
react/chalkboard/card-face-actions.ts
react/chalkboard/web-card-registry-actions.ts
react/components/SkillViewerOverlay.tsx
react/components/channels/ChannelTabBar.tsx
react/components/preview/model/index.ts
react/components/preview/print-preview.ts
react/components/shared/MediaViewer/MediaViewer.tsx
react/market/MarketModalShell.tsx
react/mobile/MobileApp.tsx
react/mobile/MobileChalkboardCardPage.tsx
react/plugin-ui/app-custom-theme-actions.ts
react/plugin-ui/app-storage-actions.ts
react/plugin-ui/plugin-storage-actions.ts
```

### 2.4 状态管理（zustand）
- 全局 `create(` 出现 **529 次**，确认使用 **zustand** 作为状态库（与 `package.json` 的 `zustand@^5` 一致）。
- 大量 `useSyncExternalStore`（77 次）用于订阅外部 store。
- ⚠️ 具体 store 名称/形状被混淆，无法从静态分析可靠还原（如 `useXStore` 的 X 已变 `hL` 之类）。
  复刻时需自行设计 store 切分。

### 2.5 后端 API 契约（前端调用的 `/api/*` 端点，节选高频项）

| 端点（`:id` 已归一） | 命中次数 | 推断用途 |
|---|---|---|
| `/api/permissions/app-capability` | 40 | 应用能力/权限查询 |
| `/api/agents/` ` /api/agents` | 38/9 | Agent 配置与列表 |
| `/api/apps/` ` /api/apps` | 25/7 | 已安装 App |
| `/api/config` | 20 | 运行时配置 |
| `/api/preferences/appearance` | 13 | **外观偏好**（主题/字体/对比度） |
| `/api/mcp/connectors/` | 11 | MCP 连接器 |
| `/api/desk/files` ` /api/desk/cron` | 10/10 | 桌面文件与定时任务 |
| `/api/skills/bundles/` | 9 | 技能包 |
| `/api/workspace/actions` ` /api/workspace/content` | 8/5 | 工作区操作 |
| `/api/preview-documents/` | 8 | 文档预览 |
| `/api/preferences/studio-ui-state` | 8 | 工作室 UI 状态 |
| `/api/confirm/` | 8 | 权限/操作确认 |
| `/api/cards/` ` /api/cards/export` | 8/3 | 卡片 CRUD / 导出 |
| `/api/terminals/` ` /api/terminals/start` | 7/2 | 终端 |
| `/api/studio/workspaces/` | 7 | 工作室工作区 |
| `/api/providers/` ` /api/providers/fetch-models` | 7/3 | 模型供应商 |
| `/api/models` | 7 | 模型列表 |
| `/api/channels/` | 7 | 频道（ChannelTabBar 对应） |
| `/api/sessions` ` /api/sessions/search` | 3/2 | 会话 |
| `/api/memories/compiled` | 4 | **记忆**（编译后的长期记忆） |
| `/api/web-auth/login` ` /api/web-auth/session` | 4/3 | Web 登录 |
| `/api/upload-blob` | 4 | 二进制上传 |
| `/api/health` | 5 | 健康检查 |
| `/api/extensions/` ` /api/extensions/install-tasks` | 5/3 | 扩展 |
| `/api/bridge/{status,owner,config}` | 4/3/3 | App-Host 桥接状态 |
| `/api/client-layout-profiles/resolve` | 5 | 客户端布局配置 |
| `/api/session-thinking-level` | 4 | 思考深度（PlanMode 关联） |

> 信号："Agent + 记忆 + 技能 + MCP + 工作区 + 卡片 + 频道 + 工作室 + 扩展" 构成完整个人 AI 助手形态。
> 还有 `memories/compiled`、`session-thinking-level` 印证其"有记忆与灵魂"的产品定位。

### 2.6 主题系统（复刻 UI 的关键资产）
- 12+ 套完整主题 CSS：`themes/` 下 `warm-paper / absolutely / coral / midnight / midnight-contrast /
  high-contrast / grass-aroma / contemplation / delve / deep-think / new-warm-paper / continuous-corners` 等。
- 通过 `document.documentElement.setAttribute("data-theme", ...)` 切换（grep 到 `getAttribute("data-theme")` 4 次、
  `document.documentElement` 71 次、`theme-registry` 53 次）。
- 全部以 **CSS 变量**驱动：`--accent` 出现 **711 次**、`var(--…)` 全局 **12,580 次**。
- 含 `prefers-color-scheme` 适配与 `content-contrast`（内容对比度偏好）、`paper-texture`（纸张纹理偏好）。
- 字体：Noto Serif SC / EB Garamond / PT Serif / JetBrains Mono 全套 woff2 已随包提供。

### 2.7 国际化（i18n）
- `t(` 调用 **28,379 次**，确认重度使用 `i18n`（与 `lib/i18n.js` 对应）。
- `locales/` 含 `en / ja / ko / zh / zh-TW` 五语，前端经 `use-i18n-DVssl_JP.js` 接入。
- 复刻时文案可直接复用这些 locale JSON。

### 2.8 与外壳通信（前端侧）
- `window.platform` 引用 **215 次**，`window.hana` **126 次**。
- 平台对象含：`getServerPort/getServerToken`、`getFileUrl`、`bridge`、`detectOverflow`，
  以及客户端标识 `wechat / telegram / qq / feishu`（暗示多平台消息集成）。

---

## 3. 复刻 UI 的"可用性"速查

| 想要的东西 | 是否可支撑 | 来源 |
|---|---|---|
| 配色 / 明暗主题 | ✅ 充分 | `themes/*.css`（12+ 套，含完整 token） |
| 字体与排版 | ✅ 充分 | `themes/fonts/*.woff2` |
| 组件 className 体系 | ✅ 充分 | 全局 `className` 4739 次、`var(--)` 12580 次（CSS 驱动为主） |
| 图标 / 插画 / 纹理素材 | ✅ 充分 | `assets/`（角色卡、封面、纹理、截图预览） |
| 文案（中/英/日/韩/繁） | ✅ 充分 | `locales/*.json` |
| 窗口/外壳逻辑 | ⚠️ 部分 | `bootstrap.cjs`(可读) + `main.bundle.cjs`(混淆美化) |
| 组件源码结构 | ❌ 不可 | 无 source map，仅有 14 个声明入口 + 混淆 chunk |
| 状态管理(store)形状 | ❌ 不可 | zustand store 名被混淆 |
| 后端行为契约 | ⚠️ 接口可见 | `/api/*` 端点已知，但实现需看后端源码 |

---

## 4. 建议的下一步
1. 基于 `themes/` + `styles.css`（793 个 CSS 变量）+ `assets/` 搭一个 **Vite+React+antd** 复刻骨架，套用 Hana 设计令牌。
2. 把 **后端服务层**（`server-1.1.35` tarball，含可读 `.ts` 路径注释）也纳入本目录，补全 `/api/*` 的实现。
3. 对 `main.bundle.cjs` 的 `app-host-view-*` 编排协议做逐通道注释，便于复刻桌面多窗口能力。
