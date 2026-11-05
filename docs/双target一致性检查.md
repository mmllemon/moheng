# 双 target UI 一致性检查

> 目的：让「换一个渲染容器后 UI 还是不是同一个样子」变成可执行、会失败的检查，而不是靠人盯截图。
> 建立日期：2026-10-23。**2026-11-05 重定第二 target：从 electron 改为 legacy（另一个 Chromium 构建）。**

## 1. 为什么需要这一层

moheng 计划做桌面端（Electron），但风险不在壳怎么搭，而在于**两套容器会让同一份 UI 出现两种渲染结果**，人眼很难发现「差 1px 圆角」「少一处 squircle」。

检查思路：

> 同一套断言，跑两个容器，**数字必须相等**；差值非零即失败。

这与「各自落在某个常量区间内」有本质区别：后者两边可以各自漂移还都算通过。本仓库出现过这类问题（`validate-ui-polish.mjs` 曾断言 moheng 自改的 `--accent` 而非 Hana 真值，改回真值反而 FAIL）。

**2026-11-05 的调整。** 桌面壳属于后续阶段，仓库里没有 electron 依赖、没有 main 进程，而旧的 `electron` target 与 `web` 启的是同一个 `CHROME_PATH` —— 生成的 `electron.json` 必然与 `web.json` 逐项相等，门禁会绿，但跨容器一致性一行都没验。所以第二 target 改成 **legacy**：另一个 Chromium 构建，用来覆盖真正会出事的那条路（旧内核、squircle 静默退化）。桌面壳落地后，把 legacy 换回真壳即可，判等逻辑不用动。

## 2. 硬约束：squircle 与 Chromium 139

moheng 复刻 Hana 的「纸片感」依赖 `corner-shape: squircle`，共 159 处声明。该特性**由 Chromium 139 首发**（2025-08-05）。低于 139 不会报错，只会让 159 处声明静默失效，圆角退化成普通圆角。

| Electron | Chromium | squircle | 结论 |
| --- | --- | --- | --- |
| 31.x | 126 | **不支持** | 不可用 |
| 32.x | 128 | 不支持 | 不可用 |
| 43.8.3 | 150 | 支持 | 最低可用 |
| 44.9.3 | 152 | 支持 | 可用 |
| 45.0.0 | 156 | 支持 | 当前 stable |

**结论：桌面壳若将来引入，Electron 必须 ≥ 43。** 这张表对 legacy target 同样有意义：`LEGACY_CHROME_PATH` 指向 <139 的构建，就能自动走「退化被记录」那条断言分支。

## 3. 用法

```bash
# 只跑 web（系统 Chrome，默认）
npm run ui:visual

# 只跑 legacy（另一个 Chromium 构建）
npm run ui:visual:legacy

# 两个都跑，并写出 web.json + legacy.json（门禁要的两份输入）
npm run ui:parity

# 只做比对，不启动任何进程（可放进 CI）
node scripts/validate-ui-parity.mjs

# 门禁包装：输入缺失即失败，只有 PARITY_NOT_REQUIRED=1 才放行
node scripts/gate-ui-parity.mjs

# 门禁自检：8 个人造差异，确认门禁真的会失败
node scripts/selftest-ui-parity.mjs
```

legacy 的浏览器解析顺序：`LEGACY_CHROME_PATH` → 本机 `ms-playwright/chromium-*` 里构建号最大的一个 → 交给 Playwright 自行解析。当前本机实际是 Chromium 149（系统 Chrome 156）。

两台机器/两个开发者的 Chrome 版本可能不同，所以**基线必须由同一个环境生成并提交**；换机器重跑会产生版本差异，需要重新生成并说明。

## 4. 输出

```
docs/gates/ui-parity/web.json       web target 结果（含 env.engine）
docs/gates/ui-parity/legacy.json    legacy target 结果
docs/gates/ui-parity/both.json      两 target + 比对报告合集（人读，不参与门禁）
```

单个 target 的结果包含：

```jsonc
{
  "env": { "chromiumMajor": 149, "cornerShapeSupported": true, "innerWidth": 1440, "dpr": 1,
           "engine": { "requested": "legacy", "runtime": "chromium", "signature": "chromium:149" } },
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

| 层级 | 指标 | 判据 |
| --- | --- | --- |
| 引擎 | `env.engine.signature` | 两侧必须不同，否则是同一浏览器自比，直接失败并终止比对 |
| 引擎 | `chromiumMajor` | legacy 不得新于 web（第二 target 必须代表更旧的一侧） |
| 环境 | `innerWidth` / `dpr` | 不等则尺寸类数字全部不可比 |
| 路由 | `tabs` / `visiblePanels` | 与内核无关，必须逐项相等 |
| 路由 | `rounded` / `cornerShapeAccepted` | 两侧都支持 squircle 时必须逐项相等；legacy 不支持时改为断言「legacy 的 cornerShapeAccepted 全为 false」，把退化如实记录而不是混进差异 |
| 外壳 | 侧栏 `x/y/width`、标题层 `height`、主区 `x`、设置窗、设置导航 | 布局常量，与容器无关 |
| 外壳 | `settingsNavAlpha` / `sidebarFooterAlpha` | 纸色必须都透明，一边铺色会导致观感差异 |
| 交互 | 弹窗/抽屉焦点陷阱、移动端溢出 | 布尔量，与内核版本无关 |

## 6. 浏览器支持边界（设计预期，不是缺陷）

> 与 **Chrome / Edge** 中的 web 端保持像素级一致；**Firefox / Safari** 不支持 `corner-shape`，会自动降级为普通圆角，这是设计预期。

降级逻辑在 `hana.css`：

```css
:root { --corner-radius-scale: 1; }
@supports (corner-shape: squircle) {
  :root { --corner-radius-scale: 1.8408964152537137; }
}
```

桌面壳引入后还有几项**一定会不同**、属设计预期的差异：窗口控制键、`-webkit-app-region: drag` 拖拽区、原生文件对话框、`webContents.print()`。这些都应在桌面端落地时写进产品文档，而不是当成 UI 回归。

## 7. 三个踩过的坑（别重复）

1. **`TARGET=both` 曾只写 `both.json`。** 门禁读的是 `web.json` + 第二 target 文件，所以「按文档命令生成基线」永远拿不到门禁要的输入 —— 这也是这条 advisory 债务「缺双 target 基线产物」的真实成因之一。现在按 target 分别落盘。
2. **同一引擎冒充第二 target。** 旧实现里 electron 分支启的是同一个 Chrome，两份结果必然全等。现在结果文件带 `env.engine.signature`，同签名直接失败并终止比对，不打印任何「逐项相等」。
3. **`pushState` 后死等 450ms 不够。** 2026-11-05 用 Chrome 156 对 Chromium 149 跑，`/system`、`/system/governance`、`/system/operations` 三页量到 36 个圆角、tab 为 0，直接访问却是正常的 4 个 tab —— 那三个路由的 chunk 更重，450ms 内还没挂完，量到的是上一页。现在先等最小时长，再等 DOM 连续 350ms 不变。修完后两端 26 条路由全部逐项相等。

## 8. 文件职责

| 文件 | 职责 | 是否启动进程 |
| --- | --- | --- |
| `scripts/_targets.mjs` | 双 target 抽象（系统 Chrome / 另一 Chromium 构建） | 否（被调用时） |
| `scripts/ui-visual-regression.mjs` | 跑一个或两个 target，产出 JSON | 是 |
| `scripts/validate-ui-parity.mjs` | 只读 JSON 判等/判退化，输出 PASS/FAIL | **否** |
| `scripts/selftest-ui-parity.mjs` | 人造差异验证门禁有效性 | 否（只调 validate） |
| `scripts/gate-ui-parity.mjs` | 门禁包装：输入缺失即失败 | 否 |
| `scripts/run-with-env.mjs` | 跨平台设置环境变量 | 是 |

拆成「产出」与「判等」是有意的：判等脚本不启动浏览器，可以放进任何 CI，不会因环境缺失而跳过；输入缺失时输出 `SKIP` + `结论：未进行比对（输入缺失）`，绝不打印「全部通过」。

## 9. 尚未完成的部分

1. **真正的退化路径还没跑过。** 今天 legacy 是 Chromium 149（仍支持 squircle），比对的是跨版本渲染一致性。要覆盖 <139 的静默退化，需要一份旧构建并按 `LEGACY_CHROME_PATH` 指向它重跑。
2. **基线不能由 CI 生成。** 生成基线需要本机浏览器与 dev server，CI 只跑比对。UI 改动导致指标变化时，需开发者本地重跑 `npm run ui:parity` 并提交新基线。
3. **`desktop/` 仍不存在。** 桌面壳属于后续阶段；引入后把 legacy target 换回真壳，并补窗口控制键/拖拽区/原生对话框/打印这几项差异说明。
4. **截图比对未纳入。** 当前全部是计算样式与几何断言，不依赖截图，因此容器无关。若将来需要像素级比对，需先解决字体渲染与 DPR 差异。
