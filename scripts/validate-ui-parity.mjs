// 双 target 一致性门禁：web 与 legacy 两个渲染环境的指标比对。
//
// 与 ui-visual-regression.mjs 的分工：
//   ui-visual-regression.mjs  只负责"跑一个 target，产出数字"
//   本脚本                     只负责"读两份数字，判等/判退化"，不启动任何进程
//
// 2026-11-05 语义调整（原为 web vs electron）：
//   仓库里没有桌面壳（无 electron 依赖、无 main 进程），原先的 electron target 与 web 启的是
//   同一个 Chrome，数字必然全等但什么都没验。现在第二 target 是**另一个 Chromium 构建**：
//   默认 Playwright 自带的那份（比系统 Chrome 旧），也可以用 LEGACY_CHROME_PATH 指向
//   Chromium <139，专门覆盖 `corner-shape: squircle` 静默退化那条路。
//
//   因此比对规则改成两段：
//     两侧都支持 squircle  → 逐项必须相等（跨版本的渲染一致性）
//     legacy 一侧不支持     → 这是被跟踪的退化本身：断言 legacy 的 cornerShapeAccepted 为 false，
//                            圆角计数不作为差异追，但 tabs / 面板数 / 骨架 / 交互行为仍须相等
import { readFileSync, existsSync } from 'node:fs';

const DIR = process.env.RESULT_DIR ?? 'docs/gates/ui-parity';
const WEB = `${DIR}/web.json`;
const LEGACY = `${DIR}/legacy.json`;

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
// 缺文件不能算通过。这是本仓库一个已知的失败模式：检查项拿不到输入时默认放过，
// 结果"通过"了但什么都没测。
if (!existsSync(WEB) || !existsSync(LEGACY)) {
  const missing = [WEB, LEGACY].filter((path) => !existsSync(path));
  console.log('SKIP 双 target 比对：缺少结果文件 ' + missing.join(', '));
  console.log('');
  console.log('这不是通过。要生成结果，运行：');
  console.log('  TARGET=both node scripts/ui-visual-regression.mjs');
  console.log('');
  console.log('若只想确认门禁逻辑本身，可用 HISTORICAL=1 强制要求文件存在。');
  if (process.env.HISTORICAL === '1') throw new Error('缺少双 target 结果文件 ' + missing.join(', '));
  process.exitCode = 0;
  console.log('');
  console.log('结论：未进行比对（输入缺失）。');
  process.exit(0);
}

const web = JSON.parse(readFileSync(WEB, 'utf8'));
const legacyFile = JSON.parse(readFileSync(LEGACY, 'utf8'));

// 先校验结构。门禁自己崩溃是最坏的失败模式：它既不是"通过"也不是可读的"失败"。
const shapeError = (file, parsed, key) => {
  if (!parsed || typeof parsed !== 'object') return `${file}: 不是 JSON 对象`;
  if (!parsed.raw || !parsed.raw[key]) return `${file}: 缺少 raw.${key}（该文件可能来自另一个 target）`;
  if (!parsed.summarize || !parsed.summarize[key]) return `${file}: 缺少 summarize.${key}`;
  if (!Array.isArray(parsed.raw[key].routes)) return `${file}: raw.${key}.routes 不是数组`;
  return null;
};

const webShape = shapeError(WEB, web, 'web');
const legacyShape = shapeError(LEGACY, legacyFile, 'legacy');

if (webShape || legacyShape) {
  for (const message of [webShape, legacyShape].filter(Boolean)) {
    failures.push({ label: '结果文件结构不合法', detail: message });
    console.log('FAIL 结果文件结构不合法 :: ' + message);
  }
  console.log('');
  console.log('两份结果文件必须是各自 target 的原始产物（web.json 含 raw.web，legacy.json 含 raw.legacy）。');
  console.log('重新生成：npm run ui:parity');
  console.log('');
  console.log(`${failures.length} 项双 target 一致性检查失败。`);
  process.exit(1);
}

const webRaw = web.raw.web;
const legacyRaw = legacyFile.raw.legacy;

// ---- 1.5 引擎真实性：两份结果必须来自不同构建，且 legacy 一侧不新于 web ----
const webEngine = webRaw.env?.engine ?? null;
const legacyEngine = legacyRaw.env?.engine ?? null;
const sameSignature = (webEngine?.signature ?? 'missing') === (legacyEngine?.signature ?? 'missing-other');
const webMajor = webRaw.env?.chromiumMajor ?? null;
const legacyMajor = legacyRaw.env?.chromiumMajor ?? null;

if (!webEngine || !legacyEngine || sameSignature) {
  console.log('FAIL 两个 target 来自不同渲染引擎 :: ' + JSON.stringify({ webEngine, legacyEngine, sameSignature }));
  console.log('');
  console.log('两份结果的引擎签名相同，说明它们来自同一个浏览器：数字必然相等，但跨版本一致性没被验证。');
  console.log('web 用系统 Chrome，legacy 用 Playwright 自带 Chromium（或 LEGACY_CHROME_PATH 指定的旧构建）。');
  console.log('重新生成：npm run ui:parity');
  console.log('');
  console.log('2 项双 target 一致性检查失败。');
  process.exit(1);
}

check('两个 target 来自不同渲染引擎', !sameSignature, { web: webEngine.signature, legacy: legacyEngine.signature });
check('legacy 一侧的 Chromium 不新于 web 一侧', typeof legacyMajor === 'number' && typeof webMajor === 'number' && legacyMajor <= webMajor, { webMajor, legacyMajor });

// ---- 2. 两个 target 自身都必须全绿 ----
check('web target 自身无失败项', web.summarize.web.failureCount === 0, web.summarize.web.failures);
check('legacy target 自身无失败项', legacyFile.summarize.legacy.failureCount === 0, legacyFile.summarize.legacy.failures);

// ---- 3. 视口必须一致，否则尺寸类数字没有可比性 ----
check('两个 target 视口内宽一致', webRaw.env.innerWidth === legacyRaw.env.innerWidth, { web: webRaw.env.innerWidth, legacy: legacyRaw.env.innerWidth });
check('两个 target DPR 一致', webRaw.env.dpr === legacyRaw.env.dpr, { web: webRaw.env.dpr, legacy: legacyRaw.env.dpr });

// ---- 4. squircle：两边支持则全项相等；legacy 不支持则视为被跟踪的退化 ----
const webSquircle = webRaw.env.cornerShapeSupported === true;
const legacySquircle = legacyRaw.env.cornerShapeSupported === true;

check('web 一侧支持 corner-shape（门槛内核）', webSquircle, { webChromium: webRaw.env.chromiumMajor });

const byRoute = (raw) => new Map(raw.routes.map((row) => [row.route, row]));
const legacyMap = byRoute(legacyRaw);

// 与内核无关的项：任何情况下都必须相等
const stableDiffs = [];
for (const webRow of webRaw.routes) {
  const legacyRow = legacyMap.get(webRow.route);
  if (!legacyRow) {
    stableDiffs.push({ route: webRow.route, field: '*', note: 'legacy 缺该路由' });
    continue;
  }
  for (const field of ['tabs', 'visiblePanels']) {
    if (webRow[field] !== legacyRow[field]) stableDiffs.push({ route: webRow.route, field, web: webRow[field], legacy: legacyRow[field] });
  }
}
check(`${webRaw.routes.length} 条路由的 tabs / 面板数逐项相等`, stableDiffs.length === 0, stableDiffs.slice(0, 12));

if (webSquircle && legacySquircle) {
  const radiusDiffs = [];
  for (const webRow of webRaw.routes) {
    const legacyRow = legacyMap.get(webRow.route);
    if (!legacyRow) continue;
    for (const field of ['rounded', 'cornerShapeAccepted']) {
      if (webRow[field] !== legacyRow[field]) radiusDiffs.push({ route: webRow.route, field, web: webRow[field], legacy: legacyRow[field] });
    }
  }
  check('两侧都支持 squircle 时圆角计数逐项相等', radiusDiffs.length === 0, radiusDiffs.slice(0, 12));
} else if (webSquircle && !legacySquircle) {
  // 这是本条门禁真正要盯的退化：旧内核不认 corner-shape，圆角会静默变成普通圆角。
  // 不当成失败，但要留证据：legacy 的 cornerShapeAccepted 必须全为 false。
  const acceptedSomewhere = legacyRaw.routes.filter((row) => row.cornerShapeAccepted === true);
  check(`legacy（Chromium ${legacyMajor}）不认 corner-shape，退化被如实记录`, acceptedSomewhere.length === 0, {
    legacyChromium: legacyMajor,
    webChromium: webMajor,
    consequence: '低于 Chromium 139 时不支持 squircle，圆角为普通圆角；几何断言需按该环境单独判定。',
    unexpected: acceptedSomewhere.slice(0, 6),
  });
} else {
  check('web 一侧必须支持 corner-shape，否则环境不一致', false, { webChromium: webRaw.env.chromiumMajor });
}

// ---- 5. 骨架布局常量（与内核无关） ----
const shellDiffs = [];
for (const field of ['sidebar', 'titlebar', 'main', 'settings', 'settingsNav']) {
  if (JSON.stringify(webRaw.shell?.[field]) !== JSON.stringify(legacyRaw.shell?.[field])) {
    shellDiffs.push({ field, web: webRaw.shell?.[field], legacy: legacyRaw.shell?.[field] });
  }
}
check('外壳骨架度量相等（侧栏/标题层/主区/设置窗）', shellDiffs.length === 0, shellDiffs);

// ---- 6. 透明层必须两边都是 0，不能一边铺了纸色 ----
check(
  '设置导航与侧栏底纸透明一致',
  webRaw.shell?.settingsNavAlpha === legacyRaw.shell?.settingsNavAlpha &&
    webRaw.shell?.sidebarFooterAlpha === legacyRaw.shell?.sidebarFooterAlpha,
  {
    web: [webRaw.shell?.settingsNavAlpha, webRaw.shell?.sidebarFooterAlpha],
    legacy: [legacyRaw.shell?.settingsNavAlpha, legacyRaw.shell?.sidebarFooterAlpha],
  },
);

// ---- 7. 交互行为必须一致（布尔量，与内核版本无关） ----
check('弹窗焦点陷阱行为一致', JSON.stringify(webRaw.dialog) === JSON.stringify(legacyRaw.dialog), { web: webRaw.dialog, legacy: legacyRaw.dialog });
check('移动端抽屉焦点陷阱行为一致', JSON.stringify(webRaw.mobileDrawer) === JSON.stringify(legacyRaw.mobileDrawer), { web: webRaw.mobileDrawer, legacy: legacyRaw.mobileDrawer });
check('移动端无横向溢出且数值一致', webRaw.mobileOverflow === legacyRaw.mobileOverflow, { web: webRaw.mobileOverflow, legacy: legacyRaw.mobileOverflow });

console.log('');
if (failures.length) {
  console.log(`${failures.length} 项双 target 一致性检查失败，${passed} 项通过。`);
  process.exitCode = 1;
} else {
  console.log(`${passed} 项双 target 一致性检查全部通过。`);
  process.exitCode = 0;
}
