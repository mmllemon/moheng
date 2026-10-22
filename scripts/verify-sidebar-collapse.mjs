// 侧栏折叠态验证
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

for (const width of [1440, 1024, 768, 600]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await login(page);
  await gotoRoute(page, '/projects', { settle: 1500 });

  const before = await page.evaluate(() => {
    const sb = document.querySelector('.app-sidebar');
    const mn = document.querySelector('.app-main');
    const cs = getComputedStyle(sb);
    const ms = getComputedStyle(mn);
    const r = sb.getBoundingClientRect();
    return {
      shell: document.querySelector('.app-shell').className,
      sbLeft: cs.left, sbWidth: cs.width, sbTransform: cs.transform,
      sbVisibleX: Math.round(r.x), sbW: Math.round(r.width),
      mainML: ms.marginLeft, mainW: Math.round(mn.getBoundingClientRect().width),
    };
  });

  // 点击折叠按钮（桌面端才有；移动端侧栏已隐藏，按钮在视口外）
  const toggle = await page.$('.sidebar-toggle');
  let after = null;
  if (toggle) {
    try {
      await toggle.click({ timeout: 3000 });
    } catch {
      await toggle.click({ force: true, timeout: 3000 }).catch(() => { });
    }
    await page.waitForTimeout(700);
    after = await page.evaluate(() => {
      const sb = document.querySelector('.app-sidebar');
      const mn = document.querySelector('.app-main');
      const cs = getComputedStyle(sb);
      const ms = getComputedStyle(mn);
      const r = sb.getBoundingClientRect();
      return {
        shell: document.querySelector('.app-shell').className,
        sbTransform: cs.transform, sbOpacity: cs.opacity, sbPointer: cs.pointerEvents,
        sbVisibleX: Math.round(r.x),
        mainML: ms.marginLeft, mainX: Math.round(mn.getBoundingClientRect().x), mainW: Math.round(mn.getBoundingClientRect().width),
      };
    });
    // 恢复
    await toggle.click({ force: true, timeout: 3000 }).catch(() => { });
    await page.waitForTimeout(600);
  }

  console.log(`\n=== ${width}px ===`);
  console.log(`  展开: sidebar left=${before.sbLeft} w=${before.sbWidth} x=${before.sbVisibleX} | main ml=${before.mainML} w=${before.mainW}`);
  if (after) {
    console.log(`  折叠: transform=${after.sbTransform} opacity=${after.sbOpacity} x=${after.sbVisibleX}`);
    console.log(`         main ml=${after.mainML} x=${after.mainX} w=${after.mainW}`);
    // 折叠后侧栏应完全移出视口
    const offscreen = after.sbVisibleX + (before.sbW) <= 0;
    console.log(`  侧栏完全移出视口: ${offscreen ? '✓' : '✗ 仍有残留 (x=' + after.sbVisibleX + ')'}`);
  } else {
    console.log('  （无折叠按钮，移动端）');
  }
  await ctx.close();
}

await browser.close();
