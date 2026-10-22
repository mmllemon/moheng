// 验证侧栏收起：宽度归零、主区自动撑开、四属性过渡
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);
await gotoRoute(page, '/projects', { settle: 1500 });

const snap = () => page.evaluate(() => {
  const s = document.querySelector('.app-sidebar');
  const m = document.querySelector('.app-main');
  const cs = getComputedStyle(s);
  const cm = getComputedStyle(m);
  const sr = s.getBoundingClientRect();
  const mr = m.getBoundingClientRect();
  return {
    sbW: Math.round(sr.width), sbX: Math.round(sr.x),
    sbOpacity: cs.opacity, sbMarginLeft: cs.marginLeft, sbTransform: cs.transform,
    mainX: Math.round(mr.x), mainW: Math.round(mr.width), mainMarginLeft: cm.marginLeft,
    transition: cs.transition,
  };
});

const before = await snap();
console.log('=== 展开态 ===');
console.log(`  侧栏 宽=${before.sbW} x=${before.sbX} margin-left=${before.sbMarginLeft} transform=${before.sbTransform}`);
console.log(`  主区 x=${before.mainX} 宽=${before.mainW} margin-left=${before.mainMarginLeft}`);
console.log(`  transition: ${before.transition.replace(/\s+/g, ' ').slice(0, 180)}`);

// 折叠按钮：侧栏标题栏里的那个
const btn = page.locator('.app-sidebar-titlebar button, .sidebar-collapse').first();
await btn.click({ timeout: 5000 }).catch(async () => {
  // 退回到顶栏的 restore/toggle
  await page.locator('.titlebar-icon').first().click();
});
await page.waitForTimeout(900);

const after = await snap();
console.log('\n=== 收起态 ===');
console.log(`  侧栏 宽=${after.sbW} x=${after.sbX} opacity=${after.sbOpacity} margin-left=${after.sbMarginLeft} transform=${after.sbTransform}`);
console.log(`  主区 x=${after.mainX} 宽=${after.mainW} margin-left=${after.mainMarginLeft}`);

console.log('\n=== 判定 ===');
const widthZero = after.sbW === 0;
const mainExpanded = after.mainW > before.mainW;
const noTransform = after.sbTransform === 'none' || after.sbTransform === 'matrix(1, 0, 0, 1, 0, 0)';
console.log(`  侧栏宽度归零: ${widthZero ? '✓' : '✗ 宽度=' + after.sbW}`);
console.log(`  主区撑开:     ${mainExpanded ? '✓ ' + before.mainW + '→' + after.mainW : '✗ 未变'}`);
console.log(`  无 transform: ${noTransform ? '✓' : '✗ ' + after.sbTransform}`);

await browser.close();
