// 验证内容宽度四档 + 顶栏通栏
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);
await gotoRoute(page, '/projects', { settle: 1500 });

console.log('=== 顶栏是否通栏 ===');
const tb = await page.evaluate(() => {
  const t = document.querySelector('.app-titlebar');
  const m = document.querySelector('.app-main');
  const s = document.querySelector('.app-sidebar');
  const c = getComputedStyle(t);
  const r = t.getBoundingClientRect();
  return {
    titlebarX: Math.round(r.x), titlebarW: Math.round(r.width),
    mainX: Math.round(m.getBoundingClientRect().x),
    sidebarRight: Math.round(s.getBoundingClientRect().right),
    paddingLeft: c.paddingLeft, marginLeft: c.marginLeft,
    bg: c.backgroundColor, borderBottom: c.borderBottomWidth,
  };
});
console.log(`  顶栏 x=${tb.titlebarX} 宽=${tb.titlebarW}`);
console.log(`  主区 x=${tb.mainX}，侧栏右缘=${tb.sidebarRight}`);
console.log(`  padding-left=${tb.paddingLeft}  margin-left=${tb.marginLeft}`);
console.log(`  底色=${tb.bg}  底边=${tb.borderBottom}`);
console.log(`  ${tb.titlebarX <= 8 ? '✓ 已通栏（覆盖侧栏上方）' : '✗ 未通栏'}`);

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
await page.screenshot({ path: 'D:/WorkSpace/hana/moheng/docs/gates/width-720.png', clip: { x: 0, y: 0, width: 1440, height: 300 } });

await browser.close();
