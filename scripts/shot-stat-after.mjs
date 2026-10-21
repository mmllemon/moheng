// 截图：记录整改后的统计区效果
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'D:/WorkSpace/hana/moheng/docs/gates/stat-after';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email]').first().fill('admin@local.test');
await page.locator('input[type=password]').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2600);

const shots = [
  ['progress-bills', '/cost/progress-bills', '.bill-summary-grid'],
  ['owner-finance', '/cost/owner-finance', '.owner-finance-metrics'],
  ['downstream', '/cost/downstream', '.downstream-summary-grid'],
  ['system-overview', '/system', '.system-overview-metrics'],
  ['system-security', '/system/security', '.security-metrics'],
  ['system-operations', '/system/operations', '.system-ops-summary'],
  ['parties', '/parties', '.business-party-summary-strip'],
  ['projects', '/projects', '.projects-kpi-strip'],
];

for (const [name, route, sel] of shots) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(1100);
  const el = await page.$(sel);
  if (el) {
    await el.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`✓ ${name}`);
  } else {
    console.log(`✗ ${name} 未找到 ${sel}`);
  }
}
await browser.close();
