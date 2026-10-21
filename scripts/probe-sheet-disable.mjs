// 先确认 sheet 禁用是否真的生效：禁用全部 sheet 应该让页面明显变化
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email]').first().fill('admin@local.test');
await page.locator('input[type=password]').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2200);

const probe = await page.evaluate(() => {
  const sheets = Array.from(document.styleSheets);
  const before = getComputedStyle(document.querySelector('.app-sidebar') || document.body).width;

  // 逐条 sheet 报告可禁用性
  const info = sheets.map((s, i) => ({
    i,
    disabledBefore: s.disabled,
    rules: (() => { try { return s.cssRules.length; } catch { return -1; } })(),
    firstRule: (() => {
      try {
        const r = s.cssRules[0];
        return r ? r.cssText.slice(0, 60) : '';
      } catch { return 'cors'; }
    })(),
  }));

  // 尝试禁用 sheet 2
  let disableWorked = null;
  try {
    sheets[2].disabled = true;
    disableWorked = sheets[2].disabled;
  } catch (e) { disableWorked = 'error: ' + e.message; }

  const afterSidebar = getComputedStyle(document.querySelector('.app-sidebar') || document.body).width;

  // 全禁测试
  let allDisabled = 0;
  for (const s of sheets) { try { s.disabled = true; allDisabled++; } catch {} }
  const afterAll = getComputedStyle(document.querySelector('.app-sidebar') || document.body).width;

  return { before, afterSidebar, afterAll, disableWorked, allDisabled, info };
});

console.log(JSON.stringify(probe, null, 2));
await browser.close();
