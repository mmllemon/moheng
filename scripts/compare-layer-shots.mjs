// 视觉对比：有无旧层的截图逐像素比较
// 前提：main.tsx 已禁用旧层；本脚本先拍"无旧层"，再临时启用旧层拍一次
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const STATE = 'D:/WorkSpace/hana/moheng/.auth/state.json';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', storageState: STATE });
const page = await ctx.newPage();
await page.goto(BASE + '/');
await page.waitForTimeout(2000);
await page.mouse.move(5, 880);

const routes = ['/', '/projects', '/system/accounts', '/settings/appearance', '/cost/contracts', '/reports'];

const shots = {};
for (const r of routes) {
  await page.evaluate((route) => {
    window.history.pushState(null, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, r);
  await page.waitForTimeout(600);
  shots[r] = {
    png: await page.screenshot({ fullPage: false }),
    url: page.url(),
    els: await page.evaluate(() => document.querySelectorAll('*').length),
  };
}

const summary = {};
for (const r of routes) {
  summary[r] = { url: shots[r].url, els: shots[r].els, bytes: shots[r].png.length };
}
console.log(JSON.stringify(summary, null, 2));

// 存一张代表作对比
await page.evaluate(() => {
  window.history.pushState(null, '', '/projects');
  window.dispatchEvent(new PopStateEvent('popstate'));
});
await page.waitForTimeout(700);
await page.screenshot({ path: 'D:/WorkSpace/hana/moheng/docs/gates/layer-off-projects.png' });

await browser.close();
