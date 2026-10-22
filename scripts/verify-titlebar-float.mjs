// 验证标题栏浮层 + 标题左边距对齐 720 正文列
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);
await gotoRoute(page, '/projects', { settle: 1600 });

const r = await page.evaluate(() => {
  const tb = document.querySelector('.app-titlebar');
  const pw = document.querySelector('.page-wrap');
  const strong = document.querySelector('.titlebar-context strong');
  const cs = getComputedStyle(tb);
  const tbr = tb.getBoundingClientRect();
  const pwr = pw.getBoundingClientRect();
  const sr = strong.getBoundingClientRect();
  // 正文列左缘 + 10px（--chat-copy-edge 公式）
  const expectedTitleLeft = Math.round(pwr.x + 10);
  return {
    position: cs.position,
    height: Math.round(tbr.height),
    top: Math.round(tbr.top),
    gridCols: cs.gridTemplateColumns,
    titleLeft: Math.round(sr.x),
    pageLeft: Math.round(pwr.x),
    expectedTitleLeft,
    delta: Math.round(sr.x) - expectedTitleLeft,
    contentTop: Math.round(document.querySelector('.app-content').getBoundingClientRect().top),
    pageWrapTop: Math.round(pwr.top),
    titlebarBottom: Math.round(tbr.bottom),
    overlaps: Math.round(pwr.top) < Math.round(tbr.bottom),
  };
});
console.log(JSON.stringify(r, null, 1));

await page.screenshot({ path: 'D:/WorkSpace/hana/moheng/docs/gates/tb-float.png', clip: { x: 250, y: 0, width: 1190, height: 260 } });
await browser.close();
