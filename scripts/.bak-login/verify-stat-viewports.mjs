// 多视口验收：确认不折行、无错位、system/operations 已生效
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ROUTES = [
  '/projects', '/cost/progress-bills', '/cost/owner-finance', '/cost/downstream',
  '/notifications', '/parties', '/audit-logs', '/system', '/system/security',
  '/system/operations',
];
const VIEWPORTS = [
  { w: 1440, h: 900, label: '1440 桌面' },
  { w: 1180, h: 900, label: '1180 中等' },
  { w: 1024, h: 768, label: '1024 窄屏' },
  { w: 820, h: 900, label: '820 极窄' },
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ locale: 'zh-CN' });
const page = await ctx.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email]').first().fill('admin@local.test');
await page.locator('input[type=password]').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2600);

let fails = 0;
for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.w, height: vp.h });
  console.log(`\n========== ${vp.label} (${vp.w}px) ==========`);
  for (const route of ROUTES) {
    await page.evaluate((r) => {
      window.history.pushState(null, '', r);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, route);
    await page.waitForTimeout(850);

    const info = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('[class*="grid"], [class*="metrics"], [class*="summary"], [class*="stats"], [class*="strip"]')) {
        const cs = getComputedStyle(el);
        if (!/grid/.test(cs.display)) continue;
        const strongs = el.querySelectorAll('strong');
        if (strongs.length < 2) continue;
        const vis = [...el.children].filter((c) => getComputedStyle(c).display !== 'none');
        if (vis.length < 2) continue;

        const gridR = el.getBoundingClientRect();
        // 判断是否折行：各子项的 top 是否都相同
        const tops = new Set(vis.map((c) => Math.round(c.getBoundingClientRect().top)));
        const wrapped = tops.size > 1;
        // 是否有横向滚动
        const scrollable = el.scrollWidth > el.clientWidth + 1;

        // 各子项高度是否一致（对不齐的话高度会不同）
        const heights = vis.map((c) => Math.round(c.getBoundingClientRect().height));
        const heightSpread = Math.max(...heights) - Math.min(...heights);

        // 竖线：第一个可见项不应有 border-left，其余应有
        const c0 = getComputedStyle(vis[0]);
        const c1 = vis[1] ? getComputedStyle(vis[1]) : null;

        out.push({
          cls: (el.className || '').toString().slice(0, 40),
          n: vis.length,
          wrapped,
          scrollable,
          heightSpread,
          firstBorder: c0.borderLeftWidth,
          secondBorder: c1 ? c1.borderLeftWidth : null,
          gridTop: Math.round(gridR.top),
        });
      }
      return out;
    });

    for (const i of info) {
      const bad = [];
      if (i.wrapped) bad.push('折行(第二行)');
      if (i.heightSpread > 2) bad.push(`高度差${i.heightSpread}px`);
      if (i.firstBorder !== '0px') bad.push(`首项有左线${i.firstBorder}`);
      if (i.secondBorder !== '1px') bad.push(`次项缺左线${i.secondBorder}`);
      if (bad.length) {
        fails++;
        console.log(`  ✗ ${route.padEnd(22)} ${i.cls.padEnd(30)} ${bad.join(' | ')}`);
      }
    }
  }
}

console.log(`\n${fails ? '总问题数: ' + fails : '全部通过：无折行、无错位、竖线正确'}`);
await browser.close();
