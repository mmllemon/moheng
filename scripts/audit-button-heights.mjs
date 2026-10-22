// 全站按钮高度审计：找出不一致的按钮尺寸档位
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

const rows = [];
for (const route of ROUTES) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(950);

  const btns = await page.evaluate(() => {
    const out = [];
    for (const b of document.querySelectorAll('button, a.button, [role=button]')) {
      const cs = getComputedStyle(b);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = b.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      // 只要工具栏/页头区的按钮，跳过表格行内小操作
      const cls = (b.className || '').toString();
      out.push({
        text: (b.textContent || '').trim().slice(0, 22),
        cls: cls.slice(0, 70),
        h: Math.round(r.height),
        w: Math.round(r.width),
        padY: cs.paddingTop,
        fontSize: cs.fontSize,
        minH: cs.minHeight,
        radius: cs.borderTopLeftRadius,
        isButtonClass: /(^|\s)button(\s|$)/.test(cls),
      });
    }
    return out;
  });
  for (const b of btns) rows.push({ route, ...b });
}

console.log(`=== 共 ${rows.length} 个按钮 ===\n`);

// 高度分布
const byH = new Map();
for (const r of rows) byH.set(r.h, (byH.get(r.h) || 0) + 1);
console.log('--- 高度分布 ---');
for (const [h, n] of [...byH.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${String(h).padStart(3)}px  ${String(n).padStart(3)} 个`);
}

// 带 .button 类的（主按钮体系）
const main = rows.filter((r) => r.isButtonClass);
console.log(`\n--- 带 .button 类的 ${main.length} 个 ---`);
const byH2 = new Map();
for (const r of main) {
  const k = `${r.h}px padY=${r.padY} fs=${r.fontSize} minH=${r.minH} r=${r.radius}`;
  byH2.set(k, (byH2.get(k) || 0) + 1);
}
for (const [k, n] of [...byH2.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}×  ${k}`);

// 同页高度不齐的页面
console.log('\n--- 同一页面内高度不一致 ---');
const byRoute = new Map();
for (const r of main) {
  if (!byRoute.has(r.route)) byRoute.set(r.route, new Set());
  byRoute.get(r.route).add(r.h);
}
for (const [route, hs] of byRoute) {
  if (hs.size > 1) {
    const list = main.filter((r) => r.route === route);
    console.log(`  ${route}`);
    for (const b of list) console.log(`     ${b.h}px  "${b.text}"  ${b.cls.slice(0, 46)}`);
  }
}
await browser.close();
