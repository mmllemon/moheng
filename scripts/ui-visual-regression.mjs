import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const routes = [
  '/', '/projects', '/settings/appearance', '/cost', '/cost/budget', '/cost/costs', '/cost/analysis',
  '/system', '/system/accounts', '/system/assistant', '/system/security', '/system/authorization',
  '/system/policies', '/system/governance', '/system/dictionaries',
  '/system/parameters', '/system/operations', '/audit-logs', '/reports', '/parties',
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email], #email').first().fill('admin@local.test');
await page.locator('input[type=password], #password').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2200);

const failures = [];
const routeResults = [];
for (const route of routes) {
  const before = pageErrors.length;
  await page.evaluate((nextRoute) => { window.history.pushState(null, '', nextRoute); window.dispatchEvent(new PopStateEvent('popstate')); }, route);
  await page.waitForTimeout(450);
  const result = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const rounded = Array.from(document.querySelectorAll('body *')).filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (rect.width < 60 || rect.height < 24 || rect.top > window.innerHeight || rect.bottom < 0) return false;
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      if (element.closest('.univer, [class*="univer"]')) return false;
      return parseFloat(style.borderRadius) > 4;
    }).length;
    return {
      viewport,
      scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
      rounded,
      tabs: document.querySelectorAll('.sys-tabs [role="tab"]').length,
      visiblePanels: Array.from(document.querySelectorAll('section.panel')).filter((element) => !element.hasAttribute('hidden')).length,
    };
  });
  const errors = pageErrors.slice(before);
  const failed = result.scrollWidth > result.viewport + 1 || errors.length > 0;
  if (failed) failures.push({ route, ...result, errors });
  routeResults.push({ route, ...result, errors });
  console.log(route, 'sw=' + result.scrollWidth, 'rounded=' + result.rounded, 'tabs=' + result.tabs, 'errors=' + errors.length);
}

// Dialog focus trap: open project dialog, Tab must stay inside, Esc restores trigger.
await page.goto(BASE + '/projects', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const trigger = page.getByRole('button', { name: /新建项目/ }).first();
await trigger.click();
await page.waitForTimeout(350);
let dialogTrap = true;
for (let index = 0; index < 12; index += 1) {
  await page.keyboard.press('Tab');
  const inside = await page.evaluate(() => Boolean(document.activeElement?.closest('.dialog')));
  if (!inside) dialogTrap = false;
}
await page.keyboard.press('Escape');
await page.waitForTimeout(350);
const focusBack = await page.evaluate(() => document.activeElement?.textContent?.includes('新建项目') ?? false);
if (!dialogTrap || !focusBack) failures.push({ check: 'dialog-focus-trap', dialogTrap, focusBack });

// Account menu and quick actions are popover traps, not inerting menus.
async function popoverCheck(triggerSelector, panelSelector) {
  await page.locator(triggerSelector).first().click();
  await page.waitForTimeout(250);
  let inside = true;
  for (let index = 0; index < 5; index += 1) {
    await page.keyboard.press('Tab');
    const ok = await page.evaluate((selector) => Boolean(document.activeElement?.closest(selector)), panelSelector);
    if (!ok) inside = false;
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const closed = await page.locator(panelSelector).count() === 0;
  if (!inside || !closed) failures.push({ check: panelSelector, inside, closed });
}
await popoverCheck('.titlebar-avatar', '.account-menu');
await popoverCheck('.quick-actions-wrap .titlebar-icon', '.quick-action-panel');

// Mobile navigation focus trap.
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', storageState: await context.storageState() });
const mobilePage = await mobile.newPage();
await mobilePage.goto(BASE + '/', { waitUntil: 'networkidle' });
await mobilePage.waitForTimeout(500);
const mobileOverflow = await mobilePage.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) - window.innerWidth);
await mobilePage.locator('.titlebar-mobile-menu').click();
await mobilePage.waitForTimeout(300);
let mobileTrap = true;
for (let index = 0; index < 6; index += 1) {
  await mobilePage.keyboard.press('Tab');
  const inside = await mobilePage.evaluate(() => Boolean(document.activeElement?.closest('[data-focus-trap="modal"]')));
  if (!inside) mobileTrap = false;
}
await mobilePage.keyboard.press('Escape');
await mobilePage.waitForTimeout(300);
const mobileClosed = await mobilePage.evaluate(() => !document.querySelector('.app-sidebar.mobile-nav-open'));
if (mobileOverflow > 1 || !mobileTrap || !mobileClosed) failures.push({ check: 'mobile-nav', mobileOverflow, mobileTrap, mobileClosed });

await page.evaluate(() => {
  window.history.pushState(null, '', '/system');
  window.dispatchEvent(new PopStateEvent('popstate'));
});
await page.waitForSelector('.app-sidebar', { timeout: 5000 }).catch(() => {});
await page.waitForSelector('.settings-window', { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(600);
const shellAudit = await page.evaluate(() => {
  const rect = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
  };
  const backgroundAlpha = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const value = getComputedStyle(element).backgroundColor;
    const channels = value.match(/rgba?\(([^)]+)\)/)?.[1].split(',').map(Number);
    return channels ? (channels[3] ?? 1) : null;
  };
  return {
    sidebar: rect('.app-sidebar'),
    titlebar: rect('.app-titlebar'),
    main: rect('.app-main'),
    settings: rect('.settings-window'),
    settingsNav: rect('.settings-nav'),
    settingsNavAlpha: backgroundAlpha('.settings-nav'),
    sidebarFooterAlpha: backgroundAlpha('.app-sidebar-footer'),
  };
});
const shellOk = shellAudit.sidebar?.x === 6
  && shellAudit.sidebar?.y === 6
  && shellAudit.sidebar?.width === 240
  && shellAudit.titlebar?.height === 44
  && shellAudit.main?.x === 246
  && shellAudit.settings?.width === 960
  && shellAudit.settings?.height === 722
  && shellAudit.settingsNav?.width === 208
  && shellAudit.settingsNavAlpha === 0
  && shellAudit.sidebarFooterAlpha === 0;
if (!shellOk) failures.push({ check: 'hana-shell-metrics', shellAudit });

console.log('\nSUMMARY');
console.log(JSON.stringify({ routes: routeResults.length, failures }, null, 2));
await mobile.close();
await context.close();
await browser.close();
process.exitCode = failures.length ? 1 : 0;
