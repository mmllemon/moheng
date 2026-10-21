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

for (const [route, sel] of [['/cost/downstream', '.ds-section-card'], ['/cost/costs', 'main']]) {
  await page.evaluate((r) => { window.history.pushState(null, '', r); window.dispatchEvent(new PopStateEvent('popstate')); }, route);
  await page.waitForTimeout(1200);
  const d = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { err: 'not found' };
    const walk = (n, depth = 0) => {
      if (depth > 4) return null;
      const cs = getComputedStyle(n);
      if (cs.display === 'none') return null;
      const r = n.getBoundingClientRect();
      return {
        tag: n.tagName.toLowerCase(),
        cls: (n.className || '').toString().slice(0, 46),
        w: Math.round(r.width), h: Math.round(r.height),
        disp: cs.display, dir: cs.flexDirection,
        bg: cs.backgroundColor.slice(0, 24),
        border: cs.borderTopWidth + '/' + cs.borderLeftWidth,
        radius: cs.borderTopLeftRadius,
        pad: cs.padding,
        kids: [...n.children].map((c) => walk(c, depth + 1)).filter(Boolean),
      };
    };
    return walk(el);
  }, sel);
  console.log(`\n########## ${route} ${sel} ##########`);
  const p = (n, i = 0) => {
    if (!n) return;
    console.log(`${'  '.repeat(i)}${n.tag}.${n.cls} ${n.disp}${n.dir !== 'row' ? '/' + n.dir : ''} ${n.w}x${n.h} bg=${n.bg} b=${n.border} r=${n.radius} pad=${n.pad}`);
    (n.kids || []).forEach((k) => p(k, i + 1));
  };
  p(d);
}
await browser.close();
