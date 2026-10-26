# 双 target UI 一致性检查

> 目的：让「桌面端和 web 端看起来一样」变成可执行、会失败的检查，而不是靠人盯截图。
> 建立日期：2026-10-23。

## 1. 为什么需要这一层

moheng 计划做桌面端（Electron）。风险不在于壳怎么搭，而在于**两套容器会让同一份 UI 出现两种渲染结果**，而人眼很难发现「差 1px 圆角」「少一处 squircle」。

本目录的检查思路是：

> 同一套断言，跑两个容器，**数字必须相等**。差值非零即失败。

这与「各自落在某个常量区间内」有本质区别。后者两边可以各自漂移还都算通过 ——
这正是本仓库已经出现过的问题（`validate-ui-polish.mjs` 断言的是 moheng 自己改过的
`--accent: #466b80`，而不是 Hana 真值 `#537D96`，改回真值反而会 FAIL）。

## 2. 硬约束：Electron 版本

moheng 复刻 Hana 的「纸片感」依赖 `corner-shape: squircle`，共 159 处声明。
该 CSS 特性**由 Chromium 139 首发**（2025-08-05）。

| Electron | Chromium | squircle | 结论 |
| --- | --- | --- | --- |
| 31.x（本机缓存里的版本） | 126 | **不支持** | 不可用 |
| 32.x | 128 | 不支持 | 不可用 |
| 43.8.3 | 150 | 支持 | 最低可用 |
| 44.9.3 | 152 | 支持 | 可用 |
| 45.0.0 | 156 | 支持 | 当前 stable |

**结论：Electron 必须 ≥ 43。**

用低版本不会报错，只会让 159 处 `corner-shape` 静默失效，圆角退化成普通圆角 ——
看起来「有点不一样」，但检查不出来，直到用户投诉。

检查脚本会在启动时读取 UA 里的 Chromium 主版本号，低于 139 直接记为失败项：
`chromium-too-old-for-squircle`。

## 3. 用法

```powershell
# 只跑 web（与改造前行为一致，默认）
npm run ui:visual

# 只跑 electron
npm run ui:visual:electron

# 两个都跑并生成待比对的两份结果
npm run ui:parity

# 只做比对，不启动任何进程（可放进 CI / validate 链路）
npm run validate:ui-parity

# 门禁自检：注入人造差异，确认门禁真的会失败
npm run selftest:ui-parity
```

前置条件：API 在 3001 端口可用（`npm run dev`）。脚本在 API 离线时**显式抛错**，
不会静默降级 —— 因为登录失败时所有路由都会变成登录页的重复，检查照样「通过」。

## 4. 输出

```
docs/gates/ui-parity/web.json        web target 的完整结果
docs/gates/ui-parity/electron.json   electron target 的完整结果
docs/gates/ui-parity/both.json       两 target + 比对报告的合集
```

单个 target 的结果包含：

```jsonc
{
  "env": { "chromiumMajor": 155, "cornerShapeSupported": true, "innerWidth": 1440, "dpr": 1 },
  "routes": [
    { "route": "/cost/budget", "rounded": 37, "tabs": 0, "visiblePanels": 0,
      "scrollWidth": 1440, "viewport": 1440, "cornerShapeAccepted": true }
  ],
  "shell":  { "sidebar": {...}, "titlebar": {...}, "main": {...}, "settings": {...}, "settingsNav": {...} },
  "dialog": { "trapped": true, "restored": true },
  "mobileDrawer": { "trapped": true, "closed": true },
  "mobileOverflow": 0,
  "failures": []
}
```

## 5. 判等规则

`validate-ui-parity.mjs` 逐项比对，任何不等即失败：

| 层级 | 指标 | 为什么必须相等 |
| --- | --- | --- |
| 环境 | `innerWidth` / `dpr` | 不等则尺寸类数字全部不可比 |
| 环境 | `cornerShapeSupported` | 不等时**跳过**逐指标比对并单列为环境问题，而不是混进产品差异 |
| 路由 | `rounded` 计数 | 直接测量 squircle 是否真生效 |
| 路由 | `tabs` / `visiblePanels` | 反映组件是否渲染出同样的结构 |
| 外壳 | 侧栏 `x/y/width`、标题层 `height`、主区 `x`、设置窗 `960×840`、设置导航 `208` | 布局常量，与容器无关 |
| 外壳 | `settingsNavAlpha` / `sidebarFooterAlpha` | 纸色必须都透明，一边铺色会导致观感差异 |
| 交互 | 弹窗 / 抽屉焦点陷阱、移动端溢出 | 布尔量，与 Chromium 版本无关 |

## 6. 已知的、可解释的差异（不要当成 bug）

这几项**一定会不同**，属设计预期，需写进产品文档而不是修掉：

| 项 | web | Electron | 处理 |
| --- | --- | --- | --- |
| 窗口控制键 | 无 | 系统窗控 | 不伪造 macOS 红黄绿（沿用 `设计系统-hana.md`） |
| 拖拽区 | 无 | `-webkit-app-region: drag` | 只加在标题层 |
| 文件选择 | `<input type=file>` | 原生对话框 | 统一封装 |
| 打印 | `window.print()` | `webContents.print()` | 行为不同，需单独验证 |
| **浏览器支持边界** | Chrome/Edge 有 squircle；Firefox/Safari 无 | 有 | 见下 |

关于最后一条，准确表述是：

> 桌面端与 **Chrome / Edge** 中的 web 端保持像素级一致。
> **Firefox / Safari** 不支持 `corner-shape`，会自动降级为普通圆角（`--corner-radius-scale: 1`），
> 这是设计预期而非缺陷。

降级逻辑在 `hana.css` 第 160 行：

```css
:root { --corner-radius-scale: 1; }
@supports (corner-shape: squircle) {
  :root { --corner-radius-scale: 1.8408964152537137; }
}
```

## 7. 文件职责

| 文件 | 职责 | 是否启动进程 |
| --- | --- | --- |
| `scripts/_targets.mjs` | 双 target 抽象（Chrome / Electron 统一接口） | 否（被调用时） |
| `scripts/ui-visual-regression.mjs` | 跑一个或两个 target，产出 JSON | 是 |
| `scripts/validate-ui-parity.mjs` | 只读 JSON 判等，输出 PASS/FAIL | **否** |
| `scripts/selftest-ui-parity.mjs` | 人造差异验证门禁有效性 | 否（只调 validate） |
| `scripts/run-with-env.mjs` | 跨平台设置环境变量（替代 cross-env） | 是 |

拆成「产出」与「判等」两个脚本是有意的：

- 判等脚本不启动浏览器，可以放进任何 CI，不会因环境缺失而跳过
- 输入缺失时输出 `SKIP` + `结论：未进行比对（输入缺失）`，**绝不打印「全部通过」**
- `HISTORICAL=1` 可强制要求文件存在（用于「必须已经跑过」的场景）

## 8. 尚未完成的部分

1. **`desktop/` 不存在**。Electron target 目前会在入口处给出可操作报错，属预期。
   待桌面端骨架建立后，用 `ELECTRON_ENTRY` 指定入口即可。
2. **Electron 未安装**。需 `npm install -D electron@^43`（注意 §2 的版本约束）。
3. **`validate-ui-polish.mjs` 仍断言 moheng 自改值**，未接入 Hana 真值。
   这是上一轮审查发现的问题，与本目录独立，建议后续统一。
4. **截图比对未纳入**。当前全部是计算样式与几何断言，不依赖截图，
   因此容器无关。若将来需要像素级比对，需先解决字体渲染与 DPR 差异。
