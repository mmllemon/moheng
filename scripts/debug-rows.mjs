import { chromium } from 'playwright-core';
import { login } from './_harness.mjs';
const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

for (const [route, sel] of [['/cost/contracts', '.owner-contract-detail-grid'], ['/system', '.system-overview-metrics']]) {
  await page.evaluate((r) => { window.history.pushState(null, '', r); window.dispatchEvent(new PopStateEvent('popstate')); }, route);
  await page.waitForTimeout(1000);
  const d = await page.evaluate((s) => {
    const el = document.querySelector(s);
    const cs = getComputedStyle(el);
    return {
      cols: cs.gridTemplateColumns,
      n: el.children.length,
      kids: [...el.children].map((c, i) => {
        const k = getComputedStyle(c);
        const r = c.getBoundingClientRect();
        return {
          idx: i + 1, tag: c.tagName.toLowerCase(), cls: (c.className || '').toString().slice(0, 34),
          padL: k.paddingLeft, padR: k.paddingRight, bL: k.borderLeftWidth,
          w: Math.round(r.width), top: Math.round(r.top),
        };
      }),
    };
  }, sel);
  console.log(`\n=== ${route} === cols=${d.cols} children=${d.n}`);
  for (const k of d.kids) console.log(`  #${k.idx} ${k.tag}.${k.cls.padEnd(32)} padL=${k.padL} padR=${k.padR} bL=${k.bL} ${k.w}px top=${k.top}`);
}
await browser.close();
