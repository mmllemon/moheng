// 行高方案 A/B 对比：纯 1.7 vs 分档（小字保 1.55）
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

const ROUTES = ['/', '/projects', '/cost/contracts', '/audit-logs', '/system/dictionaries'];

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

for (const route of ROUTES) {
  await gotoRoute(page, route, { settle: 1400 });

  const r = await page.evaluate(() => {
    const measure = () => {
      const out = { byFs: {}, totalH: 0, scrollH: 0 };
      for (const el of document.querySelectorAll('body *')) {
        const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
        if (!txt) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none') continue;
        const b = el.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) continue;
        const fs = cs.fontSize;
        const lh = cs.lineHeight;
        if (!out.byFs[fs]) out.byFs[fs] = new Set();
        out.byFs[fs].add(lh);
        out.totalH += b.height;
      }
      const scroller = document.querySelector('.app-content');
      out.scrollH = scroller ? scroller.scrollHeight : 0;
      return out;
    };

    const a = measure();
    return {
      fs: Object.fromEntries(Object.entries(a.byFs).map(([k, v]) => [k, [...v]])),
      totalH: Math.round(a.totalH),
      scrollH: a.scrollH,
    };
  });

  // 统计：有多少字号档的行高比偏离 1.55 或 1.7
  const lines = [];
  for (const [fs, lhs] of Object.entries(r.fs)) {
    const px = parseFloat(fs);
    for (const lh of lhs) {
      const num = parseFloat(lh);
      if (!num) continue;
      const ratio = +(num / px).toFixed(2);
      if (ratio !== 1.55 && ratio !== 1.7) {
        lines.push(`${fs}→${lh}(${ratio})`);
      }
    }
  }
  console.log(`\n${route}`);
  console.log(`  非标准行高比: ${lines.length ? lines.join(' ') : '全部为 1.55 或 1.7'}`);
  console.log(`  文本元素总高 ${r.totalH}px  内容滚动高 ${r.scrollH}px`);
}

await browser.close();
