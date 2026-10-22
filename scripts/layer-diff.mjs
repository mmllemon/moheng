// 旧层退役的安全方法：全量计算样式差异测量
//
// 原理：
//   1. 页面始终保留旧层（不删 import），保证任何时候都是可用状态
//   2. 用 CSSOM 临时禁用 legacy/v6 层，逐个元素对比 computed style
//   3. 差异清单 = 旧层独有、hana.css 未覆盖的声明
//   4. 把这些声明补进 hana.css，重跑直到差异归零 → 才可退役
//
// 覆盖：多路由 × 多交互状态（日期框、命令面板、账号菜单、对话框、设置子页）
// 采集：所有元素 + ::before/::after 伪元素 + 关键属性
import { chromium } from 'playwright-core';
import { login } from './_harness.mjs';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.argv[2] ?? 'D:/WorkSpace/hana/moheng/docs/gates/layer-diff.json';

// 逐条对比的属性（覆盖布局、盒模型、排版、视觉、层叠）
const PROPS = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'clear',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-color', 'border-top-style', 'border-bottom-color',
  'border-radius', 'border-top-left-radius',
  'background-color', 'background-image', 'box-shadow', 'opacity', 'visibility',
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
  'letter-spacing', 'text-align', 'text-transform', 'white-space', 'text-overflow', 'overflow',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'justify-content', 'align-items', 'align-self',
  'gap', 'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows', 'grid-auto-rows', 'grid-column', 'grid-row',
  'transform', 'transition', 'cursor', 'pointer-events', 'backdrop-filter', 'corner-shape',
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();

await login(page);

// 识别样式表（dev 模式下 Vite 给每个 css 注入 data-vite-dev-id）
async function sheetIds() {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll('style').forEach((el, i) => {
      const id = el.getAttribute('data-vite-dev-id') || el.id || '';
      let rules = -1;
      let first = '';
      try {
        rules = el.sheet?.cssRules.length ?? -1;
        first = el.sheet?.cssRules[0]?.cssText?.slice(0, 40) ?? '';
      } catch {}
      out.push({ i, id: id.split(/[\\/]/).pop(), rules, first });
    });
    return out;
  });
}

const sheets = await sheetIds();
console.log('=== stylesheets ===');
console.log(JSON.stringify(sheets, null, 1));

const legacyName = sheets.find((s) => s.id.includes('legacy'))?.id;
const v6Name = sheets.find((s) => s.id.includes('v6'))?.id;
if (!legacyName || !v6Name) {
  console.error('cannot identify legacy/v6 sheets; abort');
  await browser.close();
  process.exit(1);
}

// 开关某一层
async function toggleLayer(name, disabled) {
  await page.evaluate(({ target, off }) => {
    document.querySelectorAll('style').forEach((el) => {
      const id = (el.getAttribute('data-vite-dev-id') || '').split(/[\\/]/).pop() || '';
      if (id.includes(target)) {
        if (el.sheet) el.sheet.disabled = off;
      }
    });
  }, { target: name.replace(/\.css$/, ''), off: disabled });
  await page.waitForTimeout(200);
}

// 为元素生成稳定路径（用于跨状态对齐）
const COLLECT = ({ props }) => {
  const pathOf = (el) => {
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur !== document.body && depth < 6) {
      const parent = cur.parentElement;
      const idx = parent ? Array.from(parent.children).indexOf(cur) : 0;
      parts.unshift(cur.tagName.toLowerCase() + ':' + idx);
      cur = parent;
      depth++;
    }
    return parts.join('>');
  };

  const read = (el, pseudo) => {
    const cs = getComputedStyle(el, pseudo || null);
    const o = {};
    for (const p of props) o[p] = cs.getPropertyValue(p);
    return o;
  };

  const out = {};
  const els = document.querySelectorAll('body *');
  for (const el of els) {
    // 跳过纯装饰/不可见
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    const key = pathOf(el) + '|' + el.tagName.toLowerCase() + '.' + (el.className || '').toString().trim().split(/\s+/).slice(0, 3).join('.');
    out[key] = {
      rect: { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) },
      style: read(el),
      before: read(el, '::before'),
      after: read(el, '::after'),
    };
  }
  return out;
};

// 状态定义：每个状态一个 setup 函数
const STATES = [
  { name: 'home', route: '/' },
  { name: 'projects', route: '/projects' },
  { name: 'cost-contracts', route: '/cost/contracts' },
  { name: 'audit-logs', route: '/audit-logs' },
  { name: 'reports', route: '/reports' },
  { name: 'settings-appearance', route: '/settings/appearance' },
  { name: 'system-overview', route: '/system' },
  { name: 'system-accounts', route: '/system/accounts' },
  { name: 'system-parameters', route: '/system/parameters' },
  { name: 'system-operations', route: '/system/operations' },
  { name: 'system-dictionaries', route: '/system/dictionaries' },
  { name: 'system-governance', route: '/system/governance' },
  { name: 'parties', route: '/parties' },
  { name: 'notifications', route: '/notifications' },
  { name: 'account-security', route: '/account/security' },
  // 交互态
  {
    name: 'datepicker-open', route: '/audit-logs',
    setup: async () => {
      const t = page.locator('.date-picker-trigger').first();
      if (await t.count()) { await t.click(); await page.waitForTimeout(450); }
    },
  },
  {
    name: 'command-palette', route: '/',
    setup: async () => { await page.keyboard.press('Control+k'); await page.waitForTimeout(500); },
  },
  {
    name: 'project-dialog', route: '/projects',
    setup: async () => {
      const b = page.getByRole('button', { name: /新建项目/ }).first();
      if (await b.count()) { await b.click(); await page.waitForTimeout(500); }
    },
  },
];

const results = {};
for (const st of STATES) {
  await page.goto(BASE + st.route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(650);
  if (st.setup) { await st.setup(); await page.waitForTimeout(300); }

  // 基线：全部层启用
  const withLayers = await page.evaluate(COLLECT, { props: PROPS });

  // 关闭 legacy + v6
  await toggleLayer(legacyName, true);
  await toggleLayer(v6Name, true);
  await page.waitForTimeout(300);
  const withoutLayers = await page.evaluate(COLLECT, { props: PROPS });

  // 恢复
  await toggleLayer(legacyName, false);
  await toggleLayer(v6Name, false);
  await page.waitForTimeout(200);

  // 逐元素逐属性比对
  const diffs = [];
  for (const key of Object.keys(withLayers)) {
    const a = withLayers[key];
    const b = withoutLayers[key];
    if (!b) continue; // 元素消失单独记录
    const changed = {};
    for (const p of PROPS) {
      if (a.style[p] !== b.style[p]) changed[p] = { with: a.style[p], without: b.style[p] };
    }
    const beforeChanged = {};
    for (const p of PROPS) {
      if (a.before[p] !== b.before[p]) beforeChanged[p] = { with: a.before[p], without: b.before[p] };
    }
    const afterChanged = {};
    for (const p of PROPS) {
      if (a.after[p] !== b.after[p]) afterChanged[p] = { with: a.after[p], without: b.after[p] };
    }
    const rectChanged = JSON.stringify(a.rect) !== JSON.stringify(b.rect);
    if (Object.keys(changed).length || Object.keys(beforeChanged).length || Object.keys(afterChanged).length || rectChanged) {
      diffs.push({ key, rect: { with: a.rect, without: b.rect }, style: changed, before: beforeChanged, after: afterChanged });
    }
  }
  const missing = Object.keys(withLayers).filter((k) => !withoutLayers[k]);

  results[st.name] = { route: st.route, diffCount: diffs.length, missingCount: missing.length, diffs: diffs.slice(0, 400), missing: missing.slice(0, 60) };
  console.log(`${st.name}: diffs=${diffs.length} missing=${missing.length}`);
  if (st.setup) await page.keyboard.press('Escape');
}

// 汇总：按属性统计最常泄漏的
const propFreq = {};
for (const st of Object.values(results)) {
  for (const d of st.diffs) {
    for (const p of Object.keys(d.style)) propFreq['style.' + p] = (propFreq['style.' + p] || 0) + 1;
    for (const p of Object.keys(d.before)) propFreq['::before.' + p] = (propFreq['::before.' + p] || 0) + 1;
    for (const p of Object.keys(d.after)) propFreq['::after.' + p] = (propFreq['::after.' + p] || 0) + 1;
  }
}
const summary = {
  sheets,
  totalDiffElements: Object.values(results).reduce((a, s) => a + s.diffCount, 0),
  byState: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { diffs: v.diffCount, missing: v.missingCount }])),
  topProps: Object.entries(propFreq).sort((a, b) => b[1] - a[1]).slice(0, 30),
};

writeFileSync(OUT, JSON.stringify({ summary, results }, null, 2), 'utf8');
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(summary.byState, null, 1));
console.log('top props:', JSON.stringify(summary.topProps.slice(0, 15)));

await browser.close();
