// 验证底部胶囊：滚动到底时内容不被永久遮挡
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);
await gotoRoute(page, '/cost', { settle: 2000 });

// 滚到底
await page.evaluate(() => {
  const c = document.querySelector('.app-content');
  c.scrollTop = c.scrollHeight;
});
await page.waitForTimeout(600);

const m = await page.evaluate(() => {
  const pill = document.querySelector('.cost-workspace-tabs').getBoundingClientRect();
  const content = document.querySelector('.app-content');
  const pageWrap = document.querySelector('.page-wrap');
  const pwRect = pageWrap.getBoundingClientRect();
  const cs = getComputedStyle(pageWrap);
  // 找页面最底部的元素
  const all = Array.from(pageWrap.querySelectorAll('*'));
  let lowest = null;
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.height > 0 && (!lowest || r.bottom > lowest.bottom)) lowest = { bottom: r.bottom, cls: el.className?.toString().slice(0, 40) };
  }
  return {
    pillTop: Math.round(pill.top),
    pillBottom: Math.round(pill.bottom),
    scrollTop: Math.round(content.scrollTop),
    scrollMax: Math.round(content.scrollHeight - content.clientHeight),
    pageWrapPadBottom: cs.paddingBottom,
    pageWrapBottom: Math.round(pwRect.bottom),
    lowestEl: lowest ? { bottom: Math.round(lowest.bottom), cls: lowest.cls } : null,
    // 最底内容是否在胶囊上方
    clear: lowest ? Math.round(pill.top - lowest.bottom) : null,
  };
});

console.log('=== 滚到底后的状态 ===');
console.log(`  胶囊 top=${m.pillTop} bottom=${m.pillBottom}`);
console.log(`  滚动位置 ${m.scrollTop} / ${m.scrollMax}`);
console.log(`  .page-wrap padding-bottom=${m.pageWrapPadBottom}`);
console.log(`  最底元素 ${m.lowestEl?.cls} bottom=${m.lowestEl?.bottom}`);
console.log(`  胶囊上方余量 ${m.clear}px  ${m.clear >= 0 ? '✓ 内容完整可见' : '✗ 被遮挡'}`);

await page.screenshot({ path: 'D:/WorkSpace/hana/moheng/docs/gates/dock-bottom.png' });
await browser.close();
