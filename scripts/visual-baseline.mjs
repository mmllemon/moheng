// 视觉基线：给关键状态拍全量截图 + 记录布局骨架
// 基线是后续所有改动的判据：任何改动后重跑，与基线比对
import { chromium } from 'playwright-core';
import { login } from './_harness.mjs';
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DIR = 'D:/WorkSpace/hana/moheng/docs/gates/baseline';
const META = join(DIR, 'layout-meta.json');

const MODE = process.argv[2] ?? 'capture'; // capture | compare

mkdirSync(DIR, { recursive: true });

const STATES = [
  { name: '01-home', route: '/' },
  { name: '02-projects', route: '/projects' },
  { name: '03-project-overview', route: '/projects/overview' },
  { name: '04-cost-contracts', route: '/cost/contracts' },
  { name: '05-cost-budget', route: '/cost/budget' },
  { name: '06-cost-owner-finance', route: '/cost/owner-finance' },
  { name: '07-cost-analysis', route: '/cost/analysis' },
  { name: '08-reports', route: '/reports' },
  { name: '09-parties', route: '/parties' },
  { name: '10-audit-logs', route: '/audit-logs' },
  { name: '11-notifications', route: '/notifications' },
  { name: '12-settings-appearance', route: '/settings/appearance' },
  { name: '13-system-overview', route: '/system' },
  { name: '14-system-accounts', route: '/system/accounts' },
  { name: '15-system-parameters', route: '/system/parameters' },
  { name: '16-system-operations', route: '/system/operations' },
  { name: '17-system-dictionaries', route: '/system/dictionaries' },
  { name: '18-account-security', route: '/account/security' },
  // 交互态
  { name: '19-datepicker', route: '/audit-logs', setup: 'datepicker' },
  { name: '20-command-palette', route: '/', setup: 'command' },
  { name: '21-project-dialog', route: '/projects', setup: 'dialog' },
  { name: '22-account-menu', route: '/', setup: 'account' },
];

// 采集布局骨架：每个可视块的几何 + 关键排版属性
const LAYOUT_PROBE = () => {
  const out = [];
  const seen = new Set();
  const els = document.querySelectorAll('.page-wrap, .panel, .settings-section, .settings-card, .settings-row, .page-header, .data-table, .sys-split, .sys-split-side, .sys-split-main');
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    const cls = (el.className || '').toString().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    const key = cls + '|' + Math.round(r.y);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      cls,
      y: Math.round(r.y), x: Math.round(r.x),
      w: Math.round(r.width), h: Math.round(r.height),
      pad: cs.padding,
      margin: cs.margin,
      gap: cs.gap,
      display: cs.display,
      radius: cs.borderTopLeftRadius,
      bg: cs.backgroundColor,
      border: cs.borderTopWidth,
    });
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();

await login(page);
await page.mouse.move(3, 890);

const meta = {};
const compareResults = [];

for (const st of STATES) {
  await page.goto(BASE + st.route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  if (st.setup === 'datepicker') {
    const t = page.locator('.date-picker-trigger').first();
    if (await t.count()) { await t.click(); await page.waitForTimeout(450); }
  } else if (st.setup === 'command') {
    await page.keyboard.press('Control+k'); await page.waitForTimeout(500);
  } else if (st.setup === 'dialog') {
    const b = page.getByRole('button', { name: /新建项目/ }).first();
    if (await b.count()) { await b.click(); await page.waitForTimeout(500); }
  } else if (st.setup === 'account') {
    const btn = page.locator('.account-menu-wrap button, [data-account-trigger]').first();
    if (await btn.count()) { await btn.click(); await page.waitForTimeout(400); }
  }

  const file = join(DIR, st.name + '.png');
  const layout = await page.evaluate(LAYOUT_PROBE);

  if (MODE === 'capture') {
    await page.screenshot({ path: file, fullPage: false });
    meta[st.name] = { route: st.route, layout };
    console.log(`captured ${st.name}  blocks=${layout.length}`);
  } else {
    // compare：与基线布局数值比对
    const baseMeta = JSON.parse(readFileSync(META, 'utf8'));
    const base = baseMeta[st.name];
    if (!base) { compareResults.push({ name: st.name, status: 'no-baseline' }); continue; }
    const diffs = [];
    const n = Math.min(base.layout.length, layout.length);
    for (let i = 0; i < n; i++) {
      const a = base.layout[i], b = layout[i];
      for (const k of ['y', 'x', 'w', 'h', 'pad', 'gap', 'radius']) {
        if (a[k] !== b[k]) diffs.push({ block: a.cls, prop: k, base: a[k], now: b[k] });
      }
    }
    if (base.layout.length !== layout.length) diffs.push({ block: '(count)', prop: 'blocks', base: base.layout.length, now: layout.length });
    compareResults.push({ name: st.name, status: diffs.length ? 'diff' : 'same', diffs: diffs.slice(0, 20) });
    console.log(`${st.name}: ${diffs.length ? diffs.length + ' diffs' : 'same'}`);
  }

  if (st.setup) await page.keyboard.press('Escape');
}

if (MODE === 'capture') {
  writeFileSync(META, JSON.stringify(meta, null, 2), 'utf8');
  console.log(`\nbaseline saved: ${Object.keys(meta).length} states -> ${DIR}`);
} else {
  const bad = compareResults.filter((r) => r.status !== 'same');
  console.log(`\n=== compare: ${bad.length} states differ ===`);
  for (const r of bad) console.log(`${r.name}: ${r.status}`, r.diffs ? JSON.stringify(r.diffs.slice(0, 4)) : '');
  writeFileSync(join(DIR, 'compare-result.json'), JSON.stringify(compareResults, null, 2), 'utf8');
}

await browser.close();
