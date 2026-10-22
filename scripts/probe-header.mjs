// 探针：检查页头各元素的计算样式
import { chromium } from 'playwright-core';
import { CHROME, login, gotoRoute } from './_harness.mjs';

const route = process.argv[2] || '/projects';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);
await gotoRoute(page, route, { settle: 1400 });

const r = await page.evaluate(() => {
  const g = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const c = getComputedStyle(e);
    return {
      fs: c.fontSize, fw: c.fontWeight, ff: c.fontFamily.split(',')[0],
      color: c.color, mt: c.marginTop, mb: c.marginBottom,
      ai: c.alignItems, jc: c.justifyContent, gap: c.gap, ls: c.letterSpacing,
      lh: c.lineHeight,
    };
  };
  return {
    header: g('.page-header'),
    h1: g('.page-header h1'),
    p: g('.page-header p'),
    actions: g('.page-actions'),
  };
});
console.log(`路由 ${route}`);
console.log(JSON.stringify(r, null, 1));
await browser.close();
