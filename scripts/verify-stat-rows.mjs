// 多行统计区验收：检查每行的竖线是否正确（首列无线、末列无 padding）
// 判断标准不是"不能折行"，而是"折行后每行都对齐、竖线不重复"
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ROUTES = [
  '/projects', '/cost/progress-bills', '/cost/owner-finance', '/cost/downstream',
  '/cost/changes', '/cost/budget', '/cost/analysis', '/cost/contracts',
  '/notifications', '/parties', '/audit-logs', '/system', '/system/security',
  '/system/operations', '/system/authorization', '/reports',
];
const VIEWPORTS = [
  { w: 1440, h: 900, label: '1440' },
  { w: 1180, h: 900, label: '1180' },
  { w: 1024, h: 768, label: '1024' },
];
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

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
  console.log(`\n===== ${vp.w}px =====`);
  for (const route of ROUTES) {
    await page.evaluate((r) => {
      window.history.pushState(null, '', r);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, route);
    await page.waitForTimeout(800);

    const blocks = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('[class*="grid"], [class*="metrics"], [class*="summary"], [class*="stats"], [class*="strip"]')) {
        const cs = getComputedStyle(el);
        if (!/grid/.test(cs.display)) continue;
        if (el.querySelectorAll('strong').length < 2) continue;
        const vis = [...el.children].filter((c) => getComputedStyle(c).display !== 'none');
        if (vis.length < 2) continue;

        // 按 top 分行
        const rows = new Map();
        for (const c of vis) {
          const r = c.getBoundingClientRect();
          const key = Math.round(r.top);
          if (!rows.has(key)) rows.set(key, []);
          rows.get(key).push({ el: c, r });
        }
        const rowInfo = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([top, items]) => ({
          top,
          count: items.length,
          // 每行第一个是否有左线
          firstBorder: getComputedStyle(items[0].el).borderLeftWidth,
          firstPadLeft: getComputedStyle(items[0].el).paddingLeft,
          // 每行最后一个是否有 padding-right
          lastPadRight: getComputedStyle(items[items.length - 1].el).paddingRight,
          // 该行内各项高度
          heights: items.map((i) => Math.round(i.r.height)),
        }));

        out.push({
          cls: (el.className || '').toString().slice(0, 40),
          bg: cs.backgroundColor,
          radius: cs.borderTopLeftRadius,
          rowCount: rowInfo.length,
          rows: rowInfo,
        });
      }
      return out;
    });

    for (const b of blocks) {
      const bad = [];
      if (b.bg !== TRANSPARENT) bad.push(`bg=${b.bg}`);
      if (b.radius !== '0px') bad.push(`radius=${b.radius}`);

      // 逐行检查：每行首项都不该有左竖线、左内边距应为 0
      for (let i = 0; i < b.rows.length; i++) {
        const r = b.rows[i];
        if (r.firstBorder !== '0px') bad.push(`第${i + 1}行首项有左线`);
        if (r.lastPadRight !== '0px') bad.push(`第${i + 1}行末项有右内边距`);
        const spread = Math.max(...r.heights) - Math.min(...r.heights);
        // 同一行内高度差超过 2px 说明对不齐（说明文字列除外）
        if (spread > 2 && r.count > 1) bad.push(`第${i + 1}行高度差${spread}px`);
      }
      if (bad.length) {
        fails++;
        console.log(`  ✗ ${route.padEnd(24)} ${b.cls.padEnd(38)} ${b.rowCount}行  ${bad.join(' | ')}`);
      }
    }
  }
}

console.log(`\n${fails ? '问题: ' + fails : '全部通过'}`);
await browser.close();
