import { chromium } from 'playwright-core';
import { login } from './_harness.mjs';
const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

for (const [route, sel] of [['/parties', '.business-party-summary-strip'], ['/system', '.system-overview-metrics']]) {
  await page.evaluate((r) => { window.history.pushState(null, '', r); window.dispatchEvent(new PopStateEvent('popstate')); }, route);
  await page.waitForTimeout(1000);
  const d = await page.evaluate((s) => {
    const el = document.querySelector(s);
    const cs = getComputedStyle(el);
    return {
      cls: el.className,
      display: cs.display,
      cols: cs.gridTemplateColumns,
      autoFlow: cs.gridAutoFlow,
      kids: [...el.children].map((c) => {
        const k = getComputedStyle(c);
        const r = c.getBoundingClientRect();
        return {
          tag: c.tagName.toLowerCase(), cls: (c.className || '').toString().slice(0, 30),
          display: k.display, position: k.position,
          gridColumn: k.gridColumn, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top),
        };
      }),
    };
  }, sel);
  console.log(`\n=== ${route} ===`);
  console.log(`container: ${d.cls} | display=${d.display} | cols=${d.cols} | flow=${d.autoFlow}`);
  for (const k of d.kids) console.log(`  ${k.tag}.${k.cls.padEnd(28)} disp=${k.display.padEnd(6)} pos=${k.position.padEnd(8)} col=${k.gridColumn.padEnd(10)} ${k.w}x${k.h} top=${k.top}`);
}
await browser.close();
