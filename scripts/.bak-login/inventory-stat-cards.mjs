// 盘点墨衡所有统计卡：类名、DOM 结构、使用页面
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'D:/WorkSpace/hana/moheng/docs/gates/stat-cards-inventory.json';

const ROUTES = [
  '/', '/projects', '/cost/contracts', '/cost/budget', '/cost/progress-bills',
  '/cost/changes', '/cost/downstream', '/cost/owner-finance', '/cost/costs', '/cost/analysis',
  '/reports', '/parties', '/audit-logs', '/system', '/system/security',
  '/system/authorization', '/system/parameters', '/system/operations', '/system/dictionaries',
  '/notifications', '/account/security', '/settings/appearance',
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email], #email').first().fill('admin@local.test');
await page.locator('input[type=password]').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2600);

const inventory = {};

for (const route of ROUTES) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(1000);

  const found = await page.evaluate(() => {
    // 候选：类名含 summary/metric/stat/kpi 的容器，且内部有数字
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('[class*="summary"], [class*="metric"], [class*="stat"], [class*="kpi"], [class*="overview-metric"]')) {
      const cls = (el.className || '').toString();
      if (!cls || seen.has(cls)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 20) continue;
      // 必须有数字内容
      const text = (el.textContent || '').trim();
      if (!/[\d¥%]/.test(text)) continue;
      seen.add(cls);
      const cs = getComputedStyle(el);
      // 结构快照
      const children = [...el.children].map((c) => {
        const ccs = getComputedStyle(c);
        return { tag: c.tagName.toLowerCase(), cls: (c.className || '').toString().slice(0, 40), fs: ccs.fontSize, fw: ccs.fontWeight, color: ccs.color };
      });
      out.push({
        cls: cls.slice(0, 70),
        w: Math.round(r.width), h: Math.round(r.height),
        display: cs.display,
        gridCols: cs.gridTemplateColumns.slice(0, 60),
        gap: cs.gap,
        padding: cs.padding,
        bg: cs.backgroundColor,
        border: cs.borderTopWidth + ' ' + cs.borderTopColor,
        radius: cs.borderTopLeftRadius,
        childrenCount: el.children.length,
        children: children.slice(0, 4),
        textHead: text.replace(/\s+/g, ' ').slice(0, 40),
      });
    }
    return out;
  });

  if (found.length) inventory[route] = found;
}

// 汇总：所有出现过的卡片类名
const allClasses = new Set();
for (const list of Object.values(inventory)) for (const c of list) allClasses.add(c.cls);

console.log('=== 各页面统计卡 ===');
for (const [route, list] of Object.entries(inventory)) {
  console.log(`\n${route} (${list.length})`);
  for (const c of list.slice(0, 8)) {
    console.log(`  ${c.cls.slice(0, 44).padEnd(46)} ${c.w}x${c.h} ${c.display} pad=${c.padding} bg=${c.bg.slice(0, 22)}`);
  }
}

console.log(`\n=== 共 ${allClasses.size} 种卡片类 ===`);
for (const c of [...allClasses].sort()) console.log('  ' + c);

writeFileSync(OUT, JSON.stringify({ inventory, classes: [...allClasses].sort() }, null, 2), 'utf8');
await browser.close();
