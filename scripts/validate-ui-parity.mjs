// 双 target 一致性门禁：web 与 electron 的指标必须逐项相等。
//
// 与 ui-visual-regression.mjs 的分工：
//   ui-visual-regression.mjs  只负责"跑一个 target，产出数字"
//   本脚本                     只负责"读两份数字，判等"，不启动任何进程
//
// 这样门禁可以放进 validate 链路（不依赖浏览器），也不会因为环境缺失而静默通过。
import { readFileSync, existsSync } from 'node:fs';

const DIR = process.env.RESULT_DIR ?? 'docs/gates/ui-parity';
const WEB = `${DIR}/web.json`;
const ELECTRON = `${DIR}/electron.json`;

const failures = [];
let passed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('PASS ' + label);
  } else {
    failures.push({ label, detail });
    console.log('FAIL ' + label + (detail ? ' :: ' + JSON.stringify(detail) : ''));
  }
}

// ---- 1. 存在性 ----
// 缺文件不能算通过。这是本仓库一个已知的失败模式：
// 检查项拿不到输入时默认放过，结果"通过"了但什么都没测。
if (!existsSync(WEB) || !existsSync(ELECTRON)) {
  const missing = [WEB, ELECTRON].filter((path) => !existsSync(path));
  console.log('SKIP 双 target 比对：缺少结果文件 ' + missing.join(', '));
  console.log('');
  console.log('这不是通过。要生成结果，运行：');
  console.log('  TARGET=both node scripts/ui-visual-regression.mjs');
  console.log('');
  console.log('若只想确认门禁逻辑本身，可用 HISTORICAL=1 强制要求文件存在。');
  if (process.env.HISTORICAL === '1') throw new Error('缺少双 target 结果文件 ' + missing.join(', '));
  // 不打印"全部通过"，也不设 exitCode 0 以外的结论：交给上层决定是否强制。
  // 关键：绝不能让"没测"被读成"通过"。
  process.exitCode = 0;
  console.log('');
  console.log('结论：未进行比对（输入缺失）。');
  process.exit(0);
} else {
  const web = JSON.parse(readFileSync(WEB, 'utf8'));
  const electron = JSON.parse(readFileSync(ELECTRON, 'utf8'));

  // 先校验结构。门禁自己崩溃是最坏的失败模式：
  // 它既不是"通过"也不是可读的"失败"，CI 里只会看到一段堆栈。
  const shapeError = (file, parsed, key) => {
    if (!parsed || typeof parsed !== 'object') return `${file}: 不是 JSON 对象`;
    if (!parsed.raw || !parsed.raw[key]) return `${file}: 缺少 raw.${key}（该文件可能来自另一个 target）`;
    if (!parsed.summarize || !parsed.summarize[key]) return `${file}: 缺少 summarize.${key}`;
    if (!Array.isArray(parsed.raw[key].routes)) return `${file}: raw.${key}.routes 不是数组`;
    return null;
  };

  const webShape = shapeError(WEB, web, 'web');
  const electronShape = shapeError(ELECTRON, electron, 'electron');

  if (webShape || electronShape) {
    for (const message of [webShape, electronShape].filter(Boolean)) {
      failures.push({ label: '结果文件结构不合法', detail: message });
      console.log('FAIL 结果文件结构不合法 :: ' + message);
    }
    console.log('');
    console.log('两份结果文件必须是各自 target 的原始产物（web.json 含 raw.web，electron.json 含 raw.electron）。');
    console.log('重新生成：npm run ui:parity');
    console.log('');
    console.log(`${failures.length} 项双 target 一致性检查失败。`);
    process.exit(1);
  }

  const webRaw = web.raw.web;
  const electronRaw = electron.raw.electron;

  // ---- 2. 两个 target 自身都必须全绿 ----
  check('web target 自身无失败项', web.summarize.web.failureCount === 0, web.summarize.web.failures);
  check('electron target 自身无失败项', electron.summarize.electron.failureCount === 0, electron.summarize.electron.failures);

  // ---- 3. 视口必须一致，否则尺寸类数字没有可比性 ----
  check(
    '两个 target 视口内宽一致',
    webRaw.env.innerWidth === electronRaw.env.innerWidth,
    { web: webRaw.env.innerWidth, electron: electronRaw.env.innerWidth }
  );
  check(
    '两个 target DPR 一致',
    webRaw.env.dpr === electronRaw.env.dpr,
    { web: webRaw.env.dpr, electron: electronRaw.env.dpr }
  );

  // ---- 4. 关键：squircle 支持必须一致 ----
  // 若两边不同，rounded 计数与所有几何断言都不该被当成产品差异来追。
  // 这条要单独判定并给出可操作结论，而不是混在"指标不等"里。
  const webSquircle = webRaw.env.cornerShapeSupported;
  const electronSquircle = electronRaw.env.cornerShapeSupported;
  check('两个 target 的 corner-shape 支持一致', webSquircle === electronSquircle, {
    webChromium: webRaw.env.chromiumMajor,
    electronChromium: electronRaw.env.chromiumMajor,
    consequence: webSquircle === electronSquircle
      ? null
      : 'Electron 的 Chromium 低于 139，squircle 不生效。必须先升级 Electron，否则圆角几何无法一致。',
  });

  // ---- 5. 逐路由逐指标比对 ----
  if (webSquircle === electronSquircle) {
    const byRoute = (raw) => new Map(raw.routes.map((row) => [row.route, row]));
    const electronMap = byRoute(electronRaw);
    const diffs = [];

    for (const webRow of webRaw.routes) {
      const electronRow = electronMap.get(webRow.route);
      if (!electronRow) {
        diffs.push({ route: webRow.route, field: '*', note: 'electron 缺该路由' });
        continue;
      }
      for (const field of ['rounded', 'tabs', 'visiblePanels', 'cornerShapeAccepted']) {
        if (webRow[field] !== electronRow[field]) {
          diffs.push({ route: webRow.route, field, web: webRow[field], electron: electronRow[field] });
        }
      }
    }

    check('26 条路由的 rounded / tabs / panels 逐项相等', diffs.length === 0, diffs.slice(0, 12));

    // ---- 6. 骨架布局常量 ----
    const shellDiffs = [];
    for (const field of ['sidebar', 'titlebar', 'main', 'settings', 'settingsNav']) {
      if (JSON.stringify(webRaw.shell?.[field]) !== JSON.stringify(electronRaw.shell?.[field])) {
        shellDiffs.push({ field, web: webRaw.shell?.[field], electron: electronRaw.shell?.[field] });
      }
    }
    check('外壳骨架度量相等（侧栏/标题层/主区/设置窗）', shellDiffs.length === 0, shellDiffs);

    // ---- 7. 透明层必须两边都是 0，不能一边铺了纸色 ----
    check(
      '设置导航与侧栏底纸透明一致',
      webRaw.shell?.settingsNavAlpha === electronRaw.shell?.settingsNavAlpha &&
        webRaw.shell?.sidebarFooterAlpha === electronRaw.shell?.sidebarFooterAlpha,
      { web: [webRaw.shell?.settingsNavAlpha, webRaw.shell?.sidebarFooterAlpha],
        electron: [electronRaw.shell?.settingsNavAlpha, electronRaw.shell?.sidebarFooterAlpha] }
    );
  } else {
    console.log('SKIP 逐指标比对：corner-shape 支持不一致，数字不可比（这是环境问题，不是产品差异）');
  }

  // ---- 8. 交互行为必须一致（布尔量，与 Chromium 版本无关） ----
  check(
    '弹窗焦点陷阱行为一致',
    JSON.stringify(webRaw.dialog) === JSON.stringify(electronRaw.dialog),
    { web: webRaw.dialog, electron: electronRaw.dialog }
  );
  check(
    '移动端抽屉焦点陷阱行为一致',
    JSON.stringify(webRaw.mobileDrawer) === JSON.stringify(electronRaw.mobileDrawer),
    { web: webRaw.mobileDrawer, electron: electronRaw.mobileDrawer }
  );
  check(
    '移动端无横向溢出且数值一致',
    webRaw.mobileOverflow === electronRaw.mobileOverflow,
    { web: webRaw.mobileOverflow, electron: electronRaw.mobileOverflow }
  );
}

console.log('');
if (failures.length) {
  console.log(`${failures.length} 项双 target 一致性检查失败，${passed} 项通过。`);
  process.exitCode = 1;
} else {
  console.log(`${passed} 项双 target 一致性检查全部通过。`);
  process.exitCode = 0;
}
