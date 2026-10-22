// 终极验证：禁用 legacy/v6 后截图对比像素差异
import { chromium } from 'playwright-core';
import { login } from './_harness.mjs';
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
await login(page);

// 移走鼠标，避免 hover 干扰
await page.mouse.move(5, 880);

const routes = ['/', '/projects', '/system/accounts', '/settings/appearance', '/cost/contracts', '/reports'];

async function shotAll(disabled) {
  await page.evaluate((idxs) => {
    const sheets = Array.from(document.styleSheets);
    sheets.forEach((s, i) => { try { s.disabled = idxs.includes(i); } catch {} });
  }, disabled);
  await page.waitForTimeout(400);

  const bufs = {};
  for (const route of routes) {
    await page.evaluate((r) => {
      window.history.pushState(null, '', r);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, route);
    await page.waitForTimeout(500);
    bufs[route] = await page.screenshot();
  }
  return bufs;
}

const withOld = await shotAll([]);
const withoutOld = await shotAll([2, 3]);

// 逐字节比较 PNG（简单可靠：完全相同 = 视觉零差异）
const results = {};
for (const route of routes) {
  const a = withOld[route];
  const b = withoutOld[route];
  results[route] = { same: Buffer.compare(a, b) === 0, sizeA: a.length, sizeB: b.length };
}

// 恢复
await page.evaluate(() => {
  const sheets = Array.from(document.styleSheets);
  sheets.forEach((s) => { try { s.disabled = false; } catch {} });
});

console.log(JSON.stringify(results, null, 2));
await browser.close();
