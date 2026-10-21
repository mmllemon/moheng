# Hana 1.1.35-beta renderer · 字节精确参考包

> 提取时间：2026-10-21。来源：本机 HanaAgent 1.1.35-beta 激活的 renderer 产物
> `C:\Users\leema\.hanako\artifacts\renderer\1.1.35-beta-win32-x64-078ca969122e698c-gb3eb2688cf11fdd0\`
> 产物整体 SHA-256：`078ca969122e698cc353bdf5727c4f50146d48909b1a0780ba4640c7b2a94cfb`（见原目录 `.verified`）
> 构建 commit：`b3eb2688cf11fdd0`（仅存在于私有源码线，GitHub 公开仓库无此对象）

这是与当前运行中 Hana 界面**逐字节一致**的可读层参考。设计系统文档
（`docs/设计系统-hana.md`）里所有"实测值"以本目录为权威依据。

## 本目录内容

| 文件 | 说明 |
|---|---|
| `styles.css` (91KB) | 1.1.35 主样式，未压缩，可读。与公开仓库版**不同**（哈希不等），1.1.35 的增改都在这里 |
| `animations.css` | 动效层，原样 |
| `themes/*.css` | 全部 12 套主题 token。注意新增了 `content-contrast.css`（五档字体对比度，1.1.35 新功能）与 `new-warm-paper.css`；`continuous-corners.css` 定义 squircle 与 `--corner-radius-scale: 1.8408964152537137`（墨衡圆角换算系数出处） |
| `index.html` + 其余 8 个 HTML 壳 | 各窗口的入口装配（main/mobile/quick-chat/onboarding/pad/browser-viewer/app-host-view/app-review） |
| `i18n.js` / `theme.js` | 运行时 i18n 与主题切换模块，未打包、可读 |
| `platform.js` / `connection-csp.js` / `boot-error.js` / `frame-message-sender.js` | 壳层小模块，原样 |
| `locales/*.json` | 五语（zh/zh-TW/en/ja/ko）1.1.35 实际生效文案 |
| `card-style/` | 卡片样式规范 `hana-card-style.css`（34KB 可读）+ 官方示例页（reading/media/charts/palette/interaction） |
| `textures/` | 纸纹原版（公开仓库版；renderer 里对应资源已内嵌于 CSS base64） |
| `vite-manifest.json` + `module-inventory.txt` | 产物 chunk 清单。304 个业务模块名可读：ChatTranscript、CardShell、StatusBar、SettingsForm、SearchInput、PlanModeButton、MediaSurface、CapabilitiesPanel、InstallReviewDialog、EmptyState、YuanSelector… 这就是 1.1.35 前端的**模块结构地图** |

## 不可读部分（边界声明）

- `assets/*.js` 235 个 chunk 是 Vite 生产构建，完全 minified，发布时无 sourcemap。
  组件**逻辑**只能参考 GitHub 公开仓库 `liliMozi/openhanako` 的历史 TSX 源码
  （本机已克隆 `D:\WorkSpace\openhanako`，Apache-2.0），或按 manifest 模块名反推重建。
- 公开仓库源码与 1.1.35 存在版本差（release-digest 明示 "source remains private"），
  对照时以本目录的 CSS/HTML/locales 为实测基准，TSX 只作结构参考。

## 使用提示

- 快速定位某个视觉决策：先在 `styles.css` / `themes/` 里 grep 对应 CSS 变量名，
  它们是本版本真值；再查 `locales/zh.json` 找对应文案键。
- 墨衡的 Web 场景不需要 Electron preload/windowControls 部分；
  抓取以布局、token、控件几何、动效时长为主。
