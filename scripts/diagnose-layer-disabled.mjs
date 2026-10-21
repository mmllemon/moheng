// 诊断：禁用 legacy/v6 后哪些页面元素消失或错位
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });

page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text().slice(0, 200)); });

await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email]').first().fill('admin@local.test');
await page.locator('input[type=password]').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2500);

const state = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).map((b) => b.textContent?.trim().slice(0, 20));
  const sheets = Array.from(document.styleSheets).map((s, i) => ({
    i,
    rules: (() => { try { return s.cssRules.length; } catch { return -1; } })(),
    first: (() => { try { return s.cssRules[0]?.cssText.slice(0, 50); } catch { return 'cors'; } })(),
  }));
  return {
    url: location.pathname,
    buttonCount: document.querySelectorAll('button').length,
    buttons: btn.slice(0, 25),
    sheets,
    appShell: !!document.querySelector('.app-shell'),
    pageWrap: !!document.querySelector('.page-wrap'),
  };
});

console.log(JSON.stringify(state, null, 2));

// 截图存档
await page.screenshot({ path: 'D:/WorkSpace/hana/moheng/docs/gates/layer-disabled.png', fullPage: false });
await browser.close();
