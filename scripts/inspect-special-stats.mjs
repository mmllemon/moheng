// 检查几个结构特殊页面的真实 DOM，判断它们到底是不是"统计指标"
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email]').first().fill('admin@local.test');
await page.locator('input[type=password]').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2600);

const TARGETS = [
  ['/reports', '.report-studio-entry-grid'],
  ['/parties', '.business-party-summary-strip'],
  ['/system', '.system-overview-metrics'],
  ['/system/operations', '.system-ops-summary'],
  ['/system/assistant', '.assistant-check-grid'],
  ['/system/authorization', '.system-authorization-scope-grid'],
];

for (const [route, sel] of TARGETS) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(1000);

  const dump = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { error: 'not found' };
    const outline = (n, d = 0) => {
      if (d > 3) return null;
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      return {
        tag: n.tagName.toLowerCase(),
        cls: (n.className || '').toString().slice(0, 40),
        text: (n.textContent || '').trim().slice(0, 40),
        w: Math.round(r.width),
        h: Math.round(r.height),
        display: cs.display,
        dir: cs.flexDirection,
        kids: [...n.children].filter((c) => {
          const ccs = getComputedStyle(c);
          return ccs.display !== 'none';
        }).map((c) => outline(c, d + 1)),
      };
    };
    return { grid: outline(el), childCount: el.children.length };
  }, sel);

  console.log(`\n========== ${route}  ${sel} (${dump.childCount} 项) ==========`);
  const walk = (n, indent = 0) => {
    if (!n) return;
    const pad = '  '.repeat(indent);
    console.log(`${pad}${n.tag}.${n.cls}  ${n.display}${n.dir !== 'row' ? '/' + n.dir : ''}  ${n.w}x${n.h}  "${n.text}"`);
    for (const k of n.kids || []) walk(k, indent + 1);
  };
  walk(dump.grid);
}
await browser.close();
