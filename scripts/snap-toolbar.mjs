// 实测工具栏族关键元素的实际计算值，确认删除后不会变
import { chromium } from 'playwright-core';
import { login } from './_harness.mjs';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const PROBES = [
  { route: '/', sel: '.page-header', props: ['display', 'alignItems', 'justifyContent', 'gap', 'marginBottom', 'paddingTop', 'flexDirection'] },
  { route: '/', sel: '.page-header h1', props: ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'fontFamily', 'marginTop', 'marginBottom'] },
  { route: '/', sel: '.page-header p', props: ['fontSize', 'color', 'lineHeight', 'letterSpacing', 'marginTop'] },
  { route: '/', sel: '.page-actions', props: ['display', 'alignItems', 'gap', 'flexWrap', 'width', 'justifyContent'] },
  { route: '/cost/contracts', sel: '.section-heading h2', props: ['fontSize', 'fontWeight', 'color', 'marginTop'] },
  { route: '/cost/contracts', sel: '.section-heading p', props: ['fontSize', 'color', 'marginTop'] },
  { route: '/cost/contracts', sel: '.table-toolbar', props: ['display', 'alignItems', 'justifyContent', 'gap', 'paddingTop', 'paddingBottom', 'borderBottomWidth', 'borderBottomColor'] },
  { route: '/cost/contracts', sel: '.table-toolbar .toolbar-search', props: ['width', 'height', 'borderTopWidth', 'borderTopColor', 'borderTopLeftRadius', 'backgroundColor'] },
  { route: '/cost/contracts', sel: '.table-toolbar .toolbar-search input', props: ['width', 'minWidth', 'fontSize', 'backgroundColor', 'borderTopWidth'] },
  { route: '/cost/owner-finance', sel: '.owner-finance-page .page-header', props: ['alignItems', 'gap', 'marginBottom', 'flexDirection'] },
  { route: '/cost/owner-finance', sel: '.owner-finance-page .page-actions', props: ['flexWrap', 'justifyContent'] },
  { route: '/system/dictionaries', sel: '.system-management-page .page-header', props: ['alignItems', 'flexDirection', 'gap'] },
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

const routeCache = new Set();
const snap = {};

for (const p of PROBES) {
  if (!routeCache.has(p.route)) {
    await page.evaluate((r) => {
      window.history.pushState(null, '', r);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, p.route);
    await page.waitForTimeout(1100);
    routeCache.add(p.route);
  }
  const val = await page.evaluate(([sel, props]) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const o = {};
    for (const k of props) o[k] = cs[k];
    return o;
  }, [p.sel, p.props]);
  if (!val) { console.log(`  [缺失] ${p.route} ${p.sel}`); continue; }
  snap[`${p.sel}`] = val;
  console.log(`\n${p.sel}`);
  for (const [k, v] of Object.entries(val)) console.log(`    ${k}: ${v}`);
}

writeFileSync('docs/gates/toolbar-before.json', JSON.stringify(snap, null, 2));
console.log('\n→ docs/gates/toolbar-before.json');
await browser.close();
