// 精确列出每个统计容器的真实类名 + 卡片类名 + 图标类名
import { chromium } from 'playwright-core';

import { login } from './_harness.mjs';
const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ROUTES = [
  '/', '/projects', '/projects/members',
  '/cost/contracts', '/cost/budget', '/cost/progress-bills', '/cost/changes',
  '/cost/downstream', '/cost/owner-finance', '/cost/costs', '/cost/analysis',
  '/reports', '/reports/designer', '/reports/studio',
  '/notifications', '/parties', '/audit-logs',
  '/settings/appearance',
  '/system', '/system/security', '/system/authorization', '/system/policies',
  '/system/governance', '/system/operations', '/system/dictionaries',
  '/system/parameters', '/system/accounts', '/system/assistant',
  '/account/security',
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
  await page.waitForTimeout(950);

  const found = await page.evaluate(() => {
    const out = [];
    const cands = new Set();
    for (const el of document.querySelectorAll('[class*="grid"], [class*="metrics"], [class*="summary"], [class*="stats"], [class*="strip"]')) {
      const r = el.getBoundingClientRect();
      if (r.height < 40 || r.width < 300) continue;
      const cs = getComputedStyle(el);
      if (!/grid|flex/.test(cs.display)) continue;
      if (el.querySelectorAll('strong, [class*="value"]').length < 2) continue;
      cands.add(el);
    }
    for (const el of cands) {
      const cards = [...el.children];
      out.push({
        grid: (el.className || '').toString(),
        childCount: cards.length,
        cardCls: cards.slice(0, 3).map((c) => (c.className || '').toString()),
        // 卡片内所有 class（含图标）
        innerClasses: [...new Set(cards.slice(0, 1).flatMap((c) => [...c.querySelectorAll('*')].map((n) => (n.className || '').toString()).filter(Boolean)))].slice(0, 14),
        hasSvg: cards.slice(0, 1).some((c) => !!c.querySelector('svg')),
      });
    }
    return out;
  });
  if (found.length) all.push({ route, blocks: found });
}

for (const r of all) {
  console.log(`\n### ${r.route}`);
  for (const b of r.blocks) {
    console.log(`  grid: ${b.grid}`);
    console.log(`    cards(${b.childCount}): ${JSON.stringify(b.cardCls)}`);
    if (b.hasSvg) console.log(`    inner: ${JSON.stringify(b.innerClasses)}`);
  }
}
await browser.close();
