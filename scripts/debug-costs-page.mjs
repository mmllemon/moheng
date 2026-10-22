import { chromium } from 'playwright-core';
import { login } from './_harness.mjs';
const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

await page.evaluate(() => { window.history.pushState(null, '', '/cost/costs'); window.dispatchEvent(new PopStateEvent('popstate')); });
await page.waitForTimeout(1400);

const d = await page.evaluate(() => {
  const main = document.querySelector('.page-wrap');
  const out = [];
  const walk = (n, depth = 0) => {
    if (depth > 3) return;
    const cs = getComputedStyle(n);
    if (cs.display === 'none') return;
    const r = n.getBoundingClientRect();
    const text = (n.textContent || '').trim().slice(0, 60);
    out.push({
      d: depth,
      tag: n.tagName.toLowerCase(),
      cls: (n.className || '').toString().slice(0, 50),
      w: Math.round(r.width), h: Math.round(r.height),
      disp: cs.display, dir: cs.flexDirection,
      bg: cs.backgroundColor.slice(0, 22),
      border: cs.borderTopWidth + '/' + cs.borderLeftWidth,
      radius: cs.borderTopLeftRadius,
      pad: cs.padding,
      text,
    });
    for (const c of n.children) walk(c, depth + 1);
  };
  if (main) walk(main);
  return out;
});
for (const x of d) {
  console.log(`${'  '.repeat(x.d)}${x.tag}.${x.cls} ${x.disp}${x.dir !== 'row' ? '/' + x.dir : ''} ${x.w}x${x.h} bg=${x.bg} b=${x.border} r=${x.radius} | ${x.text}`);
}
await browser.close();
