// 一次性登录并把 storageState 存盘，后续测试复用，避免触发登录限流
// 用法：node scripts/seed-auth-state.mjs
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'D:/WorkSpace/hana/moheng/.auth/state.json';

mkdirSync('D:/WorkSpace/hana/moheng/.auth', { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();

await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email], #email').first().fill('admin@local.test');
await page.locator('input[type=password], #password').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2500);

const url = page.url();
const ok = !url.includes('/login');

if (!ok) {
  const body = await page.locator('body').innerText().catch(() => '');
  console.error('LOGIN FAILED. url=' + url);
  console.error('page text (first 300):', body.slice(0, 300));
} else {
  await ctx.storageState({ path: OUT });
  console.log('saved auth state ->', OUT);
}

await browser.close();
process.exit(ok ? 0 : 1);
