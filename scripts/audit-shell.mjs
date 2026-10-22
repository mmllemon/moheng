// 顶栏可见图标实测 + 三主题截图
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

for (const theme of ['warm-paper', 'midnight']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await login(page);
  await gotoRoute(page, '/projects', { settle: 1500 });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForTimeout(500);

  const r = await page.evaluate(() => {
    const icons = [...document.querySelectorAll('.titlebar-icon')].filter((e) => e.getBoundingClientRect().width > 1);
    const tb = document.querySelector('.app-titlebar');
    const cs = getComputedStyle(tb);
    return {
      visibleIcons: icons.map((e) => {
        const b = e.getBoundingClientRect();
        return `${Math.round(b.width)}x${Math.round(b.height)}`;
      }),
      titlebar: { h: Math.round(tb.getBoundingClientRect().height), bg: cs.backgroundColor, bb: cs.borderBottomWidth + ' ' + cs.borderBottomColor },
      sidebarBg: getComputedStyle(document.querySelector('.app-sidebar')).backgroundColor,
      sidebarBorder: (() => { const s = getComputedStyle(document.querySelector('.app-sidebar')); return s.borderRightWidth + ' ' + s.borderRightColor; })(),
    };
  });
  console.log(`\n=== ${theme} ===`);
  console.log(`  可见图标: ${r.visibleIcons.join(', ') || '无'}`);
  console.log(`  顶栏 ${r.titlebar.h}px  bg=${r.titlebar.bg}  底边=${r.titlebar.bb}`);
  console.log(`  侧栏 bg=${r.sidebarBg}  右边框=${r.sidebarBorder}`);

  await page.screenshot({ path: `D:/WorkSpace/hana/moheng/docs/gates/shell-${theme}.png`, clip: { x: 0, y: 0, width: 1440, height: 260 } });
  await ctx.close();
}

await browser.close();
