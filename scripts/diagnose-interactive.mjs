// 交互元素诊断 v2：用确实存在控件的页面
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.argv[2] ?? 'D:/WorkSpace/hana/moheng/docs/gates/interactive.json';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(e.message));

await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email], #email').first().fill('admin@local.test');
await page.locator('input[type=password], #password').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2600);

const rect = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
    display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
    z: cs.zIndex, pos: cs.position, radius: cs.borderTopLeftRadius,
    bg: cs.backgroundColor, shadow: cs.boxShadow.slice(0, 60),
    inViewport: b.x >= -10 && b.y >= -10 && b.right <= window.innerWidth + 10 && b.bottom <= window.innerHeight + 10,
  };
}, sel);

const snap = { datePicker: {}, popovers: {}, systemPages: {}, consoleErrors: [] };

// --- 日期选择框（在 /audit-logs 有 2 个）---
await page.goto(BASE + '/audit-logs', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
snap.datePicker.triggerCount = await page.evaluate(() => document.querySelectorAll('.date-picker-trigger').length);
snap.datePicker.trigger = await rect('.date-picker-trigger');

const t = page.locator('.date-picker-trigger').first();
if (await t.count()) {
  await t.click();
  await page.waitForTimeout(500);
  snap.datePicker.dialog = await rect('[role="dialog"][id^="date-picker-dialog"], .date-picker-dialog');
  snap.datePicker.popover = await rect('.date-picker-popover');
  snap.datePicker.dialogVisible = await page.locator('[id^="date-picker-dialog"]').first().isVisible().catch(() => false);
  snap.datePicker.cells = await page.evaluate(() => document.querySelectorAll('.date-picker-day').length);
  snap.datePicker.selected = await rect('.date-picker-day.is-selected');
  snap.datePicker.monthLabel = await page.evaluate(() => document.querySelector('.date-picker-month-label, .date-picker-title')?.textContent?.trim() ?? null);
  // 关键：dialog 是否在视口内
  snap.datePicker.dialogInViewport = await page.evaluate(() => {
    const d = document.querySelector('[id^="date-picker-dialog"]');
    if (!d) return null;
    const b = d.getBoundingClientRect();
    return {
      x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
      rightOverflow: Math.round(b.right - window.innerWidth),
      bottomOverflow: Math.round(b.bottom - window.innerHeight),
    };
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

// --- 账号菜单（顶栏头像）---
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const acct = await page.evaluate(() => {
  const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
  return candidates.filter((b) => /账号|admin|退出|头像/.test(b.textContent || '') || b.querySelector('.account-avatar, img')).slice(0, 3).map((b) => ({
    text: (b.textContent || '').trim().slice(0, 20),
    cls: b.className.slice(0, 60),
  }));
});
snap.popovers.accountCandidates = acct;

if (acct.length) {
  const first = page.locator('button, [role="button"]').filter({ hasText: new RegExp(acct[0].text || '账号') }).first();
  if (await first.count()) {
    await first.click().catch(() => {});
    await page.waitForTimeout(400);
    snap.popovers.accountMenu = await rect('.account-menu');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
}

// --- 系统管理每个子页 ---
const sysRoutes = ['/system', '/system/accounts', '/system/assistant', '/system/security', '/system/authorization',
  '/system/policies', '/system/governance', '/system/dictionaries', '/system/parameters', '/system/operations'];
for (const r of sysRoutes) {
  await page.goto(BASE + r, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  snap.systemPages[r] = await page.evaluate(() => {
    const g = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const win = document.querySelector('.settings-window');
    const content = document.querySelector('.settings-content');
    const nav = document.querySelector('.settings-nav');
    return {
      window: g('.settings-window'),
      nav: g('.settings-nav'),
      content: g('.settings-content'),
      cards: document.querySelectorAll('.settings-card').length,
      sections: document.querySelectorAll('.settings-section').length,
      rows: document.querySelectorAll('.settings-row').length,
      // 卡片是否真的有背景/边框（禁用旧层可能让卡片塌成透明）
      cardBg: (() => { const c = document.querySelector('.settings-card'); return c ? getComputedStyle(c).backgroundColor : null; })(),
      cardBorder: (() => { const c = document.querySelector('.settings-card'); return c ? getComputedStyle(c).borderTopWidth + ' ' + getComputedStyle(c).borderTopColor : null; })(),
      contentScrollH: content ? content.scrollHeight : null,
      contentClientH: content ? content.clientHeight : null,
      winBg: win ? getComputedStyle(win).backgroundColor : null,
    };
  });
}

snap.consoleErrors = consoleErrors;
writeFileSync(OUT, JSON.stringify(snap, null, 2), 'utf8');
console.log(JSON.stringify(snap, null, 2));
await browser.close();
