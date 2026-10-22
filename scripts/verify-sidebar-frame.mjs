// 侧栏外框精确验证：圆角、边框、阴影、位置
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);
await gotoRoute(page, '/projects', { settle: 1500 });

const r = await page.evaluate(() => {
  const sb = document.querySelector('.app-sidebar');
  const cs = getComputedStyle(sb);
  const b = sb.getBoundingClientRect();
  return {
    position: cs.position,
    box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
    border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
    radius: cs.borderTopLeftRadius,
    cornerShape: cs.cornerShape || '(不支持)',
    shadow: cs.boxShadow,
  };
});

console.log('=== 侧栏外框实测 ===');
console.log(`  position  ${r.position}`);
console.log(`  盒子      x=${r.box.x} y=${r.box.y} ${r.box.w}x${r.box.h}`);
console.log(`  边框      ${r.border}`);
console.log(`  圆角      ${r.radius}`);
console.log(`  曲率      ${r.cornerShape}`);
console.log(`  阴影      ${r.shadow}`);

// 放大截左侧栏顶部角落
await page.screenshot({ path: 'D:/WorkSpace/hana/moheng/docs/gates/sidebar-corner.png', clip: { x: 0, y: 0, width: 270, height: 180 } });

await browser.close();
