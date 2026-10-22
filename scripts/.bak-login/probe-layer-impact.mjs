// 修正版：SPA 内导航（不重建 document），确保禁用状态持续
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const PROPS = ['color', 'background-color', 'font-size', 'font-weight', 'padding-top', 'padding-left',
  'margin-top', 'border-top-width', 'border-radius', 'display', 'gap', 'height', 'box-shadow'];
const TARGETS = ['.app-sidebar', '.app-titlebar', '.page-wrap', '.page-header h1', '.panel', 'button', '.data-table td', '.settings-window', '.settings-nav', '.command-palette'];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email]').first().fill('admin@local.test');
await page.locator('input[type=password]').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2200);

const routes = ['/', '/projects', '/system/accounts', '/settings/appearance'];

async function snap() {
  const out = {};
  for (const route of routes) {
    await page.evaluate((r) => {
      window.history.pushState(null, '', r);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, route);
    await page.waitForTimeout(450);
    out[route] = await page.evaluate(({ targets, props }) => {
      const r = {};
      for (const t of targets) {
        const el = document.querySelector(t);
        if (!el) { r[t] = null; continue; }
        const cs = getComputedStyle(el);
        const o = {};
        for (const p of props) o[p] = cs.getPropertyValue(p);
        r[t] = o;
      }
      return r;
    }, { targets: TARGETS, props: PROPS });
  }
  return out;
}

const base = await snap();

async function setSheets(disableIdxs) {
  await page.evaluate((idxs) => {
    const sheets = Array.from(document.styleSheets);
    sheets.forEach((s, i) => { try { s.disabled = idxs.includes(i); } catch {} });
  }, disableIdxs);
  await page.waitForTimeout(300);
}

function diff(a, b) {
  let changed = 0;
  const detail = [];
  for (const route of Object.keys(a)) {
    for (const t of Object.keys(a[route])) {
      if (!a[route][t] || !b[route][t]) continue;
      for (const p of Object.keys(a[route][t])) {
        if (a[route][t][p] !== b[route][t][p]) {
          changed++;
          if (detail.length < 30) detail.push({ route, target: t, prop: p, before: a[route][t][p], after: b[route][t][p] });
        }
      }
    }
  }
  return { changed, detail };
}

const results = {};

// 禁用 legacy（sheet 2）
await setSheets([2]);
results.disableLegacy = diff(base, await snap());
await setSheets([]);

// 禁用 v6（sheet 3）
await setSheets([3]);
results.disableV6 = diff(base, await snap());
await setSheets([]);

// 同时禁用
await setSheets([2, 3]);
results.disableBoth = diff(base, await snap());
await setSheets([]);

console.log(JSON.stringify({
  legacyChanged: results.disableLegacy.changed,
  v6Changed: results.disableV6.changed,
  bothChanged: results.disableBoth.changed,
  legacyDetail: results.disableLegacy.detail,
  v6Detail: results.disableV6.detail,
}, null, 2));

await browser.close();
