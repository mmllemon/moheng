// 探测工具栏族元素在哪些路由真实存在
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ROUTES = [
  '/', '/projects', '/projects/members', '/cost/contracts', '/cost/budget',
  '/cost/progress-bills', '/cost/changes', '/cost/downstream', '/cost/owner-finance',
  '/cost/costs', '/cost/analysis', '/reports', '/reports/designer', '/notifications',
  '/parties', '/audit-logs', '/settings/appearance', '/system', '/system/security',
  '/system/policies', '/system/governance', '/system/operations',
  '/system/dictionaries', '/system/parameters', '/system/accounts',
  '/system/assistant', '/account/security',
];

const SELECTORS = [
  '.page-header', '.page-header h1', '.page-header p', '.page-actions',
  '.section-heading', '.section-heading h2', '.section-heading p',
  '.table-toolbar', '.table-toolbar .toolbar-search', '.table-toolbar .toolbar-search input',
  '.ldg-toolbar', '.toolbar-search', '.toolbar-check', '.panel-heading h3',
  '.system-management-page', '.owner-finance-page',
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email]').first().fill('admin@local.test');
await page.locator('input[type=password]').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2600);

console.log('路由存在性矩阵（数字=元素数）\n');
console.log('路由'.padEnd(26) + SELECTORS.map((s) => s.replace(/[.\s]/g, '').slice(0, 6).padEnd(7)).join(''));
console.log('-'.repeat(26 + SELECTORS.length * 7));

const found = {};
for (const route of ROUTES) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(900);
  const counts = await page.evaluate((sels) => sels.map((s) => document.querySelectorAll(s).length), SELECTORS);
  console.log(route.padEnd(26) + counts.map((c) => (c ? String(c).padEnd(7) : '·'.padEnd(7))).join(''));
  SELECTORS.forEach((s, i) => { if (counts[i]) (found[s] ||= []).push(`${route}(${counts[i]})`); });
}

console.log('\n\n=== 每个选择器出现在哪些路由 ===');
for (const [s, routes] of Object.entries(found)) {
  console.log(`  ${s}: ${routes.slice(0, 5).join(' ')}${routes.length > 5 ? ` +${routes.length - 5}` : ''}`);
}
await browser.close();
