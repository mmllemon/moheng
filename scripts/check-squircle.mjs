// 验证 squircle 是否真的生效（这决定 22px 圆角的视觉观感）
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

  // 检测 @supports 是否成立
  const supportsSquircle = CSS.supports('corner-shape', 'squircle');
  const scale = getComputedStyle(document.documentElement).getPropertyValue('--corner-radius-scale').trim();

  // 采样侧栏左上角的实际像素形状：沿对角线找边框像素位置
  return {
    supportsSquircle,
    scale,
    computedRadius: cs.borderTopLeftRadius,
    cornerShape: cs.cornerShape,
  };
});

console.log('=== squircle 支持检测 ===');
console.log(`  CSS.supports('corner-shape','squircle')  = ${r.supportsSquircle}`);
console.log(`  --corner-radius-scale                   = ${r.scale || '(未设置)'}`);
console.log(`  侧栏 borderTopLeftRadius                = ${r.computedRadius}`);
console.log(`  侧栏 cornerShape                        = ${r.cornerShape || '(空，说明不支持)'}`);

if (!r.supportsSquircle) {
  console.log('\n⚠ 当前浏览器不支持 corner-shape: squircle → 22px 就是普通圆角，确实过大');
} else {
  console.log('\n✓ squircle 生效，22px 的超椭圆视觉上接近普通圆角 12-14px');
}

await browser.close();
