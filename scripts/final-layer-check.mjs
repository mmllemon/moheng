// 最终视觉确认：在同一会话内比较"有旧层"与"无旧层"
// 做法：注入 CSSOM 层面禁用 @layer legacy + 把 v6 的规则全置空，然后截图对比
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email], #email').first().fill('admin@local.test');
await page.locator('input[type=password], #password').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2600);
await page.mouse.move(3, 890);

const routes = ['/', '/projects', '/system/accounts', '/settings/appearance', '/cost/contracts', '/reports'];
const results = [];

for (const r of routes) {
  await page.evaluate((route) => {
    window.history.pushState(null, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, r);
  await page.waitForTimeout(650);

  const shotA = await page.screenshot();

  // 禁用旧层（当前构建已不含旧层，所以这里验证的是"当前状态"与"页面是否正常"）
  const info = await page.evaluate(() => ({
    url: location.pathname,
    els: document.querySelectorAll('*').length,
    hasShell: !!document.querySelector('.app-shell'),
    hasSidebar: !!document.querySelector('.app-sidebar'),
    sidebarWidth: document.querySelector('.app-sidebar') ? getComputedStyle(document.querySelector('.app-sidebar')).width : null,
    h1Font: document.querySelector('.page-header h1') ? getComputedStyle(document.querySelector('.page-header h1')).fontFamily.split(',')[0] : null,
    h1Weight: document.querySelector('.page-header h1') ? getComputedStyle(document.querySelector('.page-header h1')).fontWeight : null,
    sheets: Array.from(document.styleSheets).length,
  }));

  results.push({ route: r, ...info, shotBytes: shotA.length });
}

console.log(JSON.stringify(results, null, 2));
await browser.close();
