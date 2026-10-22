// 验证内容宽度四档 + 标题栏浮层几何（对齐 hana ._titlebarFrame）
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);
await gotoRoute(page, '/projects', { settle: 1500 });

console.log('=== 标题栏：hana ._titlebarFrame 几何 ===');
const tb = await page.evaluate(() => {
  const t = document.querySelector('.app-titlebar');
  const m = document.querySelector('.app-main');
  const s = document.querySelector('.app-sidebar');
  const pw = document.querySelector('.page-wrap');
  const strong = document.querySelector('.titlebar-context strong');
  const c = getComputedStyle(t);
  const r = t.getBoundingClientRect();
  const mr = m.getBoundingClientRect();
  const pwr = pw.getBoundingClientRect();
  const sr = strong.getBoundingClientRect();
  return {
    position: c.position,
    height: Math.round(r.height),
    mainX: Math.round(mr.x), mainW: Math.round(mr.width),
    titlebarX: Math.round(r.x), titlebarW: Math.round(r.width),
    titleLeft: Math.round(sr.x),
    pageLeft: Math.round(pwr.x), pageW: Math.round(pwr.width),
    paddingLeft: c.paddingLeft,
    bg: c.backgroundColor, borderBottom: c.borderBottomWidth,
    contentTop: Math.round(document.querySelector('.app-content').getBoundingClientRect().top),
    pageWrapTop: Math.round(pwr.top),
  };
});
const copyEdge = tb.pageLeft + 10;
console.log(`  定位=${tb.position}  高=${tb.height}px  顶=${tb.contentTop}`);
console.log(`  覆盖主区 ${tb.titlebarX}→${tb.titlebarX + tb.titlebarW}（主区 ${tb.mainX} 宽 ${tb.mainW}）`);
console.log(`  标题左缘 ${tb.titleLeft}，正文列左缘 ${tb.pageLeft}，期望 ${copyEdge}，偏差 ${tb.titleLeft - copyEdge}`);
console.log(`  底色=${tb.bg}  底边=${tb.borderBottom}`);
console.log(`  内容未被推下：.page-wrap top=${tb.pageWrapTop}（标题栏高 ${tb.height}，重叠属正常）`);

const ok = tb.position === 'absolute' && tb.height === 36 && tb.titleLeft === copyEdge
  && tb.bg === 'rgba(0, 0, 0, 0)' && tb.borderBottom === '0px';
console.log(`  ${ok ? '✓ 符合 hana 浮层标题栏' : '✗ 不符'}`);

console.log('\n=== 内容宽度四档 ===');
for (const w of ['640', '720', '800', 'unlimited']) {
  await page.evaluate((width) => { document.documentElement.dataset.pageWidth = width; }, w);
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => {
    const pw = document.querySelector('.page-wrap');
    const cs = getComputedStyle(pw);
    const b = pw.getBoundingClientRect();
    return { w: Math.round(b.width), x: Math.round(b.x), maxW: cs.maxWidth };
  });
  console.log(`  ${w.padEnd(10)} 实测宽 ${String(r.w).padStart(4)}px  max-width=${r.maxW}  x=${r.x}`);
}

await page.evaluate(() => { document.documentElement.dataset.pageWidth = '720'; });
await page.waitForTimeout(300);
await browser.close();
