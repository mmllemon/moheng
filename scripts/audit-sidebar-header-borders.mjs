// 查侧栏头部图标的边框来源
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);
await gotoRoute(page, '/projects', { settle: 1500 });

const r = await page.evaluate(() => {
  const out = [];
  const header = document.querySelector('.app-sidebar-titlebar');
  const walk = (el, depth) => {
    if (depth > 3) return;
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    if (b.width < 1) return;
    const bw = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].map((k) => parseFloat(cs[k])).reduce((a, c) => a + c, 0);
    if (bw > 0 || cs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
      const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).join('.');
      out.push({
        tag: el.tagName.toLowerCase() + (cls ? '.' + cls : ''),
        depth,
        border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
        bg: cs.backgroundColor,
        radius: cs.borderTopLeftRadius,
        size: `${Math.round(b.width)}x${Math.round(b.height)}`,
      });
    }
    for (const c of el.children) walk(c, depth + 1);
  };
  walk(header, 0);

  // 也看 profile 段
  const profile = document.querySelector('.app-sidebar-profile');
  const out2 = [];
  if (profile) {
    const cs = getComputedStyle(profile);
    out2.push({
      tag: '.app-sidebar-profile',
      border: `${cs.borderTopWidth} ${cs.borderBottomWidth}`,
      bg: cs.backgroundColor,
    });
  }
  return { header: out, profile: out2 };
});

console.log('=== 侧栏头部有边框/背景的元素 ===');
for (const e of r.header) {
  console.log(`  ${'  '.repeat(e.depth)}${e.tag.padEnd(42)} ${e.size.padEnd(10)} 边框=${e.border}  底=${e.bg}`);
}
console.log('\n=== profile 段 ===');
for (const e of r.profile) console.log(`  ${e.tag}  边框=${e.border}  底=${e.bg}`);

await browser.close();
