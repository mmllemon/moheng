// 探测 notice-summary 在多视口下的实际样式，确认断点覆盖是否完好
import { chromium } from 'playwright-core';
import { CHROME, login } from './_harness.mjs';

const VIEWPORTS = [
  { w: 1440, h: 900, label: '桌面' },
  { w: 900, h: 800, label: '平板' },
  { w: 600, h: 800, label: '手机' },
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await login(page);
  await page.evaluate(() => {
    history.pushState(null, '', '/notifications');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForTimeout(1600);

  const r = await page.evaluate(() => {
    const g = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const c = getComputedStyle(e);
      return {
        gtc: c.gridTemplateColumns,
        display: c.display,
        gap: c.gap,
        padding: c.padding,
        borderLeft: c.borderLeftWidth,
        borderBottom: c.borderBottomWidth,
        bg: c.backgroundColor,
      };
    };
    return { grid: g('.notice-summary-grid'), card: g('.notice-summary-card') };
  });
  console.log(`\n=== ${vp.label} ${vp.w}px ===`);
  console.log('  grid:', JSON.stringify(r.grid));
  console.log('  card:', JSON.stringify(r.card));
  await ctx.close();
}
await browser.close();
