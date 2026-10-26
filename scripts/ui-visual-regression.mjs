// UI 视觉/交互回归 —— 双 target 版
//
// 用法：
//   node scripts/ui-visual-regression.mjs                  # 只跑 web（与旧行为一致）
//   TARGET=web      node scripts/ui-visual-regression.mjs   # 明确指定
//   TARGET=electron node scripts/ui-visual-regression.mjs   # 跑桌面端
//   TARGET=both     node scripts/ui-visual-regression.mjs   # 两个都跑并逐项比对
//
// 一致性判据（比"各自通过"强得多）：
//   每个 target 的**数字**必须相等，不是各自落在某个常量范围内。
//   差值非零即失败，并列出是哪一项、差多少。
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  launchTarget,
  assertApiUp,
  chromiumMajor,
  CORNER_SHAPE_MIN_CHROMIUM,
} from './_targets.mjs';

const TARGET = (process.env.TARGET ?? 'web').toLowerCase();
const KNOWN = ['web', 'electron', 'both'];
if (!KNOWN.includes(TARGET)) {
  throw new Error(`TARGET 只能是 ${KNOWN.join(' / ')}，收到: ${TARGET}`);
}

const OUT_DIR = process.env.RESULT_DIR ?? 'docs/gates/ui-parity';
const ROUTE_SETTLE = Number(process.env.ROUTE_SETTLE ?? 450);

const ROUTES = [
  '/', '/projects', '/notifications', '/settings/appearance', '/account/security', '/cost', '/cost/contracts',
  '/cost/budget', '/cost/progress-bills', '/cost/changes', '/cost/owner-finance', '/cost/costs', '/cost/analysis',
  '/system', '/system/accounts', '/system/assistant', '/system/security', '/system/authorization',
  '/system/policies', '/system/governance', '/system/dictionaries',
  '/system/parameters', '/system/operations', '/audit-logs', '/reports', '/parties',
];

/** 单个 target 的完整巡检，返回结构化结果（不打印 summary，由上层决定） */
async function runTarget(kind) {
  const target = await launchTarget(kind);
  const { page, pageErrors } = target;
  const failures = [];
  const routes = [];

  let env = null;
  try {
    env = await target.open('/');
    const major = chromiumMajor(env.ua);
    env.chromiumMajor = major;
    env.cornerShapeSupported = major !== null && major >= CORNER_SHAPE_MIN_CHROMIUM;

    if (!env.cornerShapeSupported) {
      failures.push({
        check: 'chromium-too-old-for-squircle',
        chromiumMajor: major,
        required: CORNER_SHAPE_MIN_CHROMIUM,
        note: 'corner-shape 在本容器内不生效，圆角会静默退化为普通圆角。与支持它的 target 比对必然不一致。',
      });
    }

    // ---- 路由巡检 ----
    for (const route of ROUTES) {
      const before = pageErrors.length;
      await page.evaluate((next) => {
        window.history.pushState(null, '', next);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, route);
      await page.waitForTimeout(ROUTE_SETTLE);

      const snapshot = await page.evaluate(() => {
        const rounded = Array.from(document.querySelectorAll('body *')).filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          if (rect.width < 60 || rect.height < 24 || rect.top > window.innerHeight || rect.bottom < 0) return false;
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          if (element.closest('.univer, [class*="univer"]')) return false;
          return parseFloat(style.borderRadius) > 4;
        }).length;

        // squircle 是否真的被浏览器接受：getComputedStyle 对未支持属性返回空串
        const probe = document.createElement('div');
        probe.style.cornerShape = 'squircle';
        const accepted = probe.style.cornerShape === 'squircle';

        return {
          viewport: window.innerWidth,
          scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
          rounded,
          cornerShapeAccepted: accepted,
          tabs: document.querySelectorAll('.sys-tabs [role="tab"]').length,
          visiblePanels: Array.from(document.querySelectorAll('section.panel'))
            .filter((element) => !element.hasAttribute('hidden')).length,
        };
      });

      const errors = pageErrors.slice(before);
      const failed = snapshot.scrollWidth > snapshot.viewport + 1 || errors.length > 0;
      if (failed) failures.push({ route, ...snapshot, errors });
      routes.push({ route, ...snapshot, errors });
    }

    // ---- 骨架度量（不含动态数字的部分可跨 target 硬比） ----
    await page.evaluate(() => {
      window.history.pushState(null, '', '/system');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.waitForSelector('.app-sidebar', { timeout: 5000 }).catch(() => {});
    await page.waitForSelector('.settings-window', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);

    const shell = await page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
      };
      const alpha = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const value = getComputedStyle(element).backgroundColor;
        const channels = value.match(/rgba?\(([^)]+)\)/)?.[1].split(',').map(Number);
        return channels ? (channels[3] ?? 1) : null;
      };
      return {
        sidebar: rect('.app-sidebar'),
        titlebar: rect('.app-titlebar'),
        main: rect('.app-main'),
        settings: rect('.settings-window'),
        settingsNav: rect('.settings-nav'),
        settingsNavAlpha: alpha('.settings-nav'),
        sidebarFooterAlpha: alpha('.app-sidebar-footer'),
      };
    });

    const shellOk =
      shell.sidebar?.x === 6 &&
      shell.sidebar?.y === 6 &&
      shell.sidebar?.width === 240 &&
      shell.titlebar?.height === 44 &&
      shell.main?.x === 246 &&
      shell.settings?.width === 960 &&
      shell.settings?.height === 840 &&
      shell.settingsNav?.width === 208 &&
      shell.settingsNavAlpha === 0 &&
      shell.sidebarFooterAlpha === 0;
    if (!shellOk) failures.push({ check: 'hana-shell-metrics', shell });

    // ---- 焦点陷阱 ----
    await page.evaluate(() => {
      window.history.pushState(null, '', '/projects');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.waitForTimeout(600);

    const dialogProbe = await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button')).find((node) =>
        (node.textContent || '').includes('新建项目')
      );
      if (!button) return { found: false };
      button.click();
      return { found: true };
    });
    await page.waitForTimeout(400);

    let dialog = null;
    if (dialogProbe.found) {
      let trapped = true;
      for (let index = 0; index < 12; index += 1) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate(() => Boolean(document.activeElement?.closest('.dialog')));
        if (!inside) trapped = false;
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(350);
      const restored = await page.evaluate(() => (document.activeElement?.textContent || '').includes('新建项目'));
      dialog = { trapped, restored };
      if (!trapped || !restored) failures.push({ check: 'dialog-focus-trap', ...dialog });
    } else {
      dialog = { found: false };
      failures.push({ check: 'dialog-trigger-missing', route: '/projects' });
    }

    // ---- 窄屏 ----
    const mobile = await target.newMobilePage({ width: 390, height: 844 });
    await mobile.open('/');
    await mobile.page.waitForTimeout(600);
    const mobileOverflow = await mobile.page.evaluate(
      () => (document.scrollingElement?.scrollWidth ?? 0) - window.innerWidth
    );

    const menuProbe = await mobile.page.evaluate(() => {
      const trigger = document.querySelector('.titlebar-mobile-menu');
      if (!trigger) return { found: false };
      trigger.click();
      return { found: true };
    });
    await mobile.page.waitForTimeout(400);

    let mobileDrawer = null;
    if (menuProbe.found) {
      let trapped = true;
      for (let index = 0; index < 6; index += 1) {
        await mobile.page.keyboard.press('Tab');
        const inside = await mobile.page.evaluate(() =>
          Boolean(document.activeElement?.closest('[data-focus-trap="modal"]'))
        );
        if (!inside) trapped = false;
      }
      await mobile.page.keyboard.press('Escape');
      await mobile.page.waitForTimeout(350);
      const closed = await mobile.page.evaluate(() => !document.querySelector('.app-sidebar.mobile-nav-open'));
      mobileDrawer = { trapped, closed };
      if (!trapped || !closed) failures.push({ check: 'mobile-nav', ...mobileDrawer });
    }
    if (mobileOverflow > 1) failures.push({ check: 'mobile-overflow', mobileOverflow });
    await mobile.close();

    return { target: kind, env, routes, shell, dialog, mobileDrawer, mobileOverflow, failures };
  } finally {
    await target.close();
  }
}

function summarize(result) {
  return {
    target: result.target,
    chromiumMajor: result.env?.chromiumMajor ?? null,
    cornerShapeSupported: result.env?.cornerShapeSupported ?? false,
    innerWidth: result.env?.innerWidth ?? null,
    innerHeight: result.env?.innerHeight ?? null,
    dpr: result.env?.dpr ?? null,
    routeCount: result.routes.length,
    failureCount: result.failures.length,
    failures: result.failures,
  };
}

/**
 * 逐项比对两个 target。
 * 只比"同一路由同一指标"的数值，不比失败信息文本 —— 文本必然不同。
 */
function compareTargets(web, electron) {
  const diffs = [];

  const byRoute = (result) => new Map(result.routes.map((row) => [row.route, row]));

  // 环境层差异（这些是可以解释的，但要显式列出）
  const envNotes = [];
  if (web.env.innerWidth !== electron.env.innerWidth) {
    envNotes.push({
      field: 'innerWidth',
      web: web.env.innerWidth,
      electron: electron.env.innerWidth,
      note: '视口内宽不同，所有尺寸类指标都不可直接比。',
    });
  }
  if (web.env.dpr !== electron.env.dpr) {
    envNotes.push({ field: 'dpr', web: web.env.dpr, electron: electron.env.dpr, note: 'DPR 不同会影响断言里的像素上限。' });
  }
  if (web.env.cornerShapeSupported !== electron.env.cornerShapeSupported) {
    envNotes.push({
      field: 'cornerShape',
      web: web.env.cornerShapeSupported,
      electron: electron.env.cornerShapeSupported,
      note:
        '两个容器的 corner-shape 支持不同（Chromium ' +
        web.env.chromiumMajor +
        ' vs ' +
        electron.env.chromiumMajor +
        '）。round 计数与几何相关的断言不可比。',
    });
  }

  const webMap = byRoute(web);
  const electronMap = byRoute(electron);
  const comparable = envNotes.length === 0;

  for (const [route, webRow] of webMap) {
    const electronRow = electronMap.get(route);
    if (!electronRow) {
      diffs.push({ route, field: '*', note: 'electron 缺少该路由' });
      continue;
    }
    for (const field of ['rounded', 'tabs', 'visiblePanels', 'cornerShapeAccepted']) {
      if (webRow[field] !== electronRow[field]) {
        diffs.push({
          route,
          field,
          web: webRow[field],
          electron: electronRow[field],
          delta: typeof webRow[field] === 'number' ? electronRow[field] - webRow[field] : null,
        });
      }
    }
  }

  // 骨架度量：即使环境有差异，这四项是布局常量，应当相等
  for (const field of ['sidebar', 'titlebar', 'main', 'settings', 'settingsNav']) {
    const a = JSON.stringify(web.shell?.[field] ?? null);
    const b = JSON.stringify(electron.shell?.[field] ?? null);
    if (a !== b) diffs.push({ route: '/system', field: `shell.${field}`, web: web.shell?.[field], electron: electron.shell?.[field] });
  }

  return { comparable, envNotes, diffs };
}

// ---------------- 主流程 ----------------
await assertApiUp();

const results = {};
if (TARGET === 'web' || TARGET === 'both') results.web = await runTarget('web');
if (TARGET === 'electron' || TARGET === 'both') results.electron = await runTarget('electron');

const report = {
  generatedAt: new Date().toISOString(),
  target: TARGET,
  summarize: Object.fromEntries(Object.entries(results).map(([key, value]) => [key, summarize(value)])),
  raw: results,
};

if (TARGET === 'both') {
  report.compare = compareTargets(results.web, results.electron);
}

mkdirSync(OUT_DIR, { recursive: true });
const outFile = `${OUT_DIR}/${TARGET}.json`;
writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');

// ---------------- 控制台输出 ----------------
for (const [key, value] of Object.entries(results)) {
  const s = report.summarize[key];
  console.log(`\n=== ${key} ===`);
  console.log(
    `chromium=${s.chromiumMajor} squircle=${s.cornerShapeSupported ? 'yes' : 'NO'} viewport=${s.innerWidth}x${s.innerHeight} dpr=${s.dpr}`
  );
  console.log(`routes=${s.routeCount} failures=${s.failureCount}`);
  for (const failure of s.failures) {
    console.log('  FAIL ' + JSON.stringify(failure));
  }
}

let exitCode = Object.values(report.summarize).some((s) => s.failureCount > 0) ? 1 : 0;

if (report.compare) {
  console.log('\n=== 跨 target 比对 ===');
  if (report.compare.envNotes.length) {
    console.log('环境差异（会导致部分指标不可比，不是产品缺陷）：');
    for (const note of report.compare.envNotes) console.log('  ' + JSON.stringify(note));
  }
  if (report.compare.diffs.length) {
    console.log(`指标体系差异 ${report.compare.diffs.length} 项：`);
    for (const diff of report.compare.diffs.slice(0, 40)) console.log('  ' + JSON.stringify(diff));
    exitCode = 1;
  } else if (report.compare.comparable) {
    console.log('两个 target 的全部指标逐项相等。');
  } else {
    console.log('指标相等，但环境存在差异（见上方 envNotes），结论需人工判断。');
  }
}

console.log(`\n结果已写入 ${outFile}`);
process.exitCode = exitCode;
