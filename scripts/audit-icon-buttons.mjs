// 把全站的图标按钮按「所属容器」归拢，看清 201 个实例到底散在哪
import { chromium } from 'playwright-core';

import { login } from './_harness.mjs';
const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ROUTES = [
  '/', '/projects', '/projects/members', '/cost/contracts', '/cost/budget',
  '/cost/progress-bills', '/cost/changes', '/cost/downstream', '/cost/owner-finance',
  '/cost/costs', '/cost/analysis', '/reports', '/reports/designer', '/reports/studio',
  '/notifications', '/parties', '/audit-logs', '/settings/appearance',
  '/system', '/system/security', '/system/authorization', '/system/policies',
  '/system/governance', '/system/operations', '/system/dictionaries',
  '/system/parameters', '/system/accounts', '/system/assistant', '/account/security',
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

const all = [];
for (const route of ROUTES) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(880);

  const items = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, [role=button], a[href]')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.height < 8 || r.width < 8) continue;
      const txt = (el.textContent || '').trim();
      const svg = el.querySelector('svg');
      // 图标按钮判据：正方形（±4）+ 无文字 或 有 svg 且文字 ≤1 字
      const square = Math.abs(r.width - r.height) <= 4;
      const isIcon = (txt.length === 0 && svg) || (txt.length <= 1 && svg && square);
      if (!isIcon) continue;

      // 找最近的有语义的祖先
      const ctxSel = '.table-toolbar, .page-actions, .table-heading-actions, .ds-section-actions,'
        + '.ldg-tools, .row-actions, .dialog-actions, .modal-actions, .settings-row,'
        + '.toolbar-view-toggle, .pagination, .pager, .data-table thead, .data-table tbody,'
        + '.table-scroll, .card-actions, .panel-head, .sidebar, .app-sidebar, .nav,'
        + '.account-menu, .toast, .banner, .empty-state';
      const owner = el.closest(ctxSel);
      let ownerName = '(无)';
      if (owner) {
        ownerName = (owner.className || '').toString().split(' ').filter(Boolean).slice(0, 2).join('.') || owner.tagName.toLowerCase();
      }

      out.push({
        cls: (el.className || '').toString().slice(0, 44),
        tag: el.tagName.toLowerCase(),
        h: Math.round(r.height),
        w: Math.round(r.width),
        square,
        pad: cs.padding,
        radius: cs.borderTopLeftRadius,
        color: cs.color.slice(0, 22),
        hasClass: /icon-button|table-action/.test(el.className || ''),
        ownerName,
        aria: el.getAttribute('aria-label') || el.getAttribute('title') || '',
      });
    }
    return out;
  });
  for (const it of items) all.push({ route, ...it });
}

console.log(`=== ${all.length} 个图标按钮（跨 ${ROUTES.length} 路由累计）===`);

// 同组件名在不同路由重复出现，按 aria/类名 去重看真实种类
const uniqKind = new Map();
for (const a of all) {
  const k = `${a.cls || '(无)'}  @${a.ownerName}  ${a.h}×${a.w}`;
  uniqKind.set(k, (uniqKind.get(k) || 0) + 1);
}
console.log(`去重后 ${uniqKind.size} 种不同规格\n`);

const withClass = all.filter((a) => a.hasClass).length;
console.log(`走 .icon-button/.table-action 的: ${withClass}`);
console.log(`裸的（无统一类）: ${all.length - withClass}\n`);

// 按 所属容器 + 类名 分组
const groups = new Map();
for (const a of all) {
  const key = `${a.ownerName}  ||  ${a.cls || '(无 class)'}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(a);
}
console.log('=== 按「容器 + 类名」分组 ===');
const sorted = [...groups.entries()].sort((x, y) => y[1].length - x[1].length);
for (const [key, list] of sorted) {
  const hs = [...new Set(list.map((a) => `${a.h}×${a.w}`))].join(' ');
  const rad = [...new Set(list.map((a) => a.radius))].join(' ');
  console.log(`\n${String(list.length).padStart(3)}×  ${key}`);
  console.log(`      尺寸: ${hs}`);
  console.log(`      圆角: ${rad}`);
  if (list[0].aria) console.log(`      例: ${list.slice(0, 3).map((x) => x.aria || x.tag).join(', ')}`);
}

console.log('\n\n=== 尺寸总分布 ===');
const byH = new Map();
for (const a of all) byH.set(`${a.h}×${a.w}`, (byH.get(`${a.h}×${a.w}`) || 0) + 1);
for (const [k, n] of [...byH.entries()].sort((x, y) => y[1] - x[1])) console.log(`  ${String(n).padStart(3)}×  ${k}`);

// ---- 断言 ----
// 图标按钮必须正方形（宽高差 ≤ 2），且尺寸必须是已登记的档位。
// 豁免：Univer 表格编辑器的第三方控件（/reports/studio），它是外部组件，
//       不属于我们的设计系统，改它会在升级时丢失。
const OK_SIZES = new Set([22, 24, 26, 28, 32]);
let bad = 0;

console.log('\n=== 断言 1：必须是正方形 ===');
const notSquare = all.filter((a) =>
  Math.abs(a.h - a.w) > 2 && a.route !== '/reports/studio');
if (!notSquare.length) console.log('  ✓ 全部正方形');
else {
  for (const a of notSquare) {
    bad++;
    console.log(`  ✗ ${a.route.padEnd(22)} ${a.h}×${a.w}  ${a.cls || '(无 class)'}  @${a.ownerName}`);
  }
}

console.log('\n=== 断言 2：尺寸必须在登记档位内 ===');
const offTier = all.filter((a) =>
  !OK_SIZES.has(a.h) && a.route !== '/reports/studio' && a.h > 8);
if (!offTier.length) console.log('  ✓ 全部在 22/24/26/28/32 内');
else {
  const seen = new Set();
  for (const a of offTier) {
    const k = `${a.cls || '(无)'} ${a.h}×${a.w}`;
    if (seen.has(k)) continue;
    seen.add(k);
    bad++;
    console.log(`  ✗ ${a.route.padEnd(22)} ${a.h}×${a.w}  ${a.cls || '(无 class)'}  @${a.ownerName}`);
  }
}

console.log(`\n${bad ? `失败：${bad} 处` : '全部通过：正方形 + 档位合法'}`);

// 非正方形（宽高差 > 2）逐个列出所在路由
console.log('\n=== 非正方形图标按钮 ===');
const odd = all.filter((a) => Math.abs(a.h - a.w) > 2);
if (!odd.length) console.log('  （无）');
else {
  const m = new Map();
  for (const a of odd) {
    const k = `${a.cls || '(无)'}  ${a.h}×${a.w}  @${a.ownerName}`;
    if (!m.has(k)) m.set(k, new Set());
    m.get(k).add(a.route);
  }
  for (const [k, routes] of m) console.log(`  ${k}\n      路由: ${[...routes].slice(0, 3).join(', ')}`);
}

await browser.close();
