// 查 B 方案的 5 个选择器实际匹配到什么、行高比是多少
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

const SEL = ['.page-header p', '.panel-heading p', '.report-description-box p', '.assistant-empty-description', '.dialog-header p'];
const ROUTES = ['/projects', '/system/dictionaries', '/audit-logs', '/cost/contracts', '/'];

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

for (const route of ROUTES) {
  await gotoRoute(page, route, { settle: 1300 });
  const r = await page.evaluate((sels) => {
    const out = [];
    for (const s of sels) {
      const els = [...document.querySelectorAll(s)];
      if (!els.length) { out.push({ sel: s, missing: true }); continue; }
      for (const el of els.slice(0, 2)) {
        const cs = getComputedStyle(el);
        const fs = parseFloat(cs.fontSize);
        const lh = parseFloat(cs.lineHeight);
        out.push({
          sel: s,
          fs: cs.fontSize,
          lh: cs.lineHeight,
          ratio: +(lh / fs).toFixed(2),
          text: (el.textContent || '').trim().slice(0, 16),
          count: els.length,
        });
      }
    }
    return out;
  }, SEL);

  console.log(`\n=== ${route} ===`);
  for (const x of r) {
    if (x.missing) { console.log(`  ${x.sel.padEnd(34)}(不存在)`); continue; }
    const mark = x.ratio === 1.7 ? ' ✓' : '';
    console.log(`  ${x.sel.padEnd(34)}${String(x.fs).padEnd(8)}${String(x.lh).padEnd(11)}ratio=${x.ratio}${mark}  "${x.text}"  (${x.count}个)`);
  }
}

await browser.close();
