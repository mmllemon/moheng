// 浮出侧栏机制验证：data-stage、动画、位置、外框
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);
await gotoRoute(page, '/projects', { settle: 1500 });

const snap = async (label) => {
  const r = await page.evaluate(() => {
    const sb = document.querySelector('.app-sidebar');
    const cs = getComputedStyle(sb);
    const b = sb.getBoundingClientRect();
    return {
      stage: sb.dataset.stage || '(无)',
      x: Math.round(b.x),
      w: Math.round(b.width),
      h: Math.round(b.height),
      transform: cs.transform,
      animName: cs.animationName,
      animDur: cs.animationDuration,
      animTiming: cs.animationTimingFunction,
      radius: cs.borderTopLeftRadius,
      cornerShape: cs.cornerShape,
      border: cs.borderTopWidth + ' ' + cs.borderTopColor,
      shadow: cs.boxShadow === 'none' ? 'none' : '有',
      mainX: Math.round(document.querySelector('.app-main').getBoundingClientRect().x),
    };
  });
  console.log(`\n=== ${label} ===`);
  console.log(`  data-stage   ${r.stage}`);
  console.log(`  位置         x=${r.x}  ${r.w}x${r.h}`);
  console.log(`  transform    ${r.transform}`);
  console.log(`  动画         ${r.animName} / ${r.animDur} / ${r.animTiming}`);
  console.log(`  外框         圆角${r.radius} 曲率${r.cornerShape} 边框${r.border} 阴影${r.shadow}`);
  console.log(`  主区 x       ${r.mainX}`);
  return r;
};

await snap('初始（挂载后）');

// 等动画结束进 idle
await page.waitForTimeout(600);
await snap('600ms 后');

// 点折叠
const toggle = await page.$('.sidebar-toggle');
if (toggle) {
  await toggle.click({ force: true }).catch(() => { });
  await page.waitForTimeout(120);
  await snap('折叠触发后 120ms（动画中）');
  await page.waitForTimeout(500);
  await snap('折叠完成');
}

await browser.close();
