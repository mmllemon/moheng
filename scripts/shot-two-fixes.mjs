import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'D:/WorkSpace/hana/moheng/docs/gates/stat-after';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email]').first().fill('admin@local.test');
await page.locator('input[type=password]').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2600);

// 分供合同页：统计区 + 上层容器
await page.evaluate(() => { window.history.pushState(null, '', '/cost/downstream'); window.dispatchEvent(new PopStateEvent('popstate')); });
await page.waitForTimeout(1400);
await page.screenshot({ path: `${OUT}/downstream-full.png`, clip: { x: 0, y: 100, width: 1440, height: 560 } });

// 实际成本页：类型卡 + 工具栏
await page.evaluate(() => { window.history.pushState(null, '', '/cost/costs'); window.dispatchEvent(new PopStateEvent('popstate')); });
await page.waitForTimeout(1400);
await page.screenshot({ path: `${OUT}/costs-full.png`, clip: { x: 0, y: 100, width: 1440, height: 620 } });

// 实测
const m = await page.evaluate(() => {
  const grid = document.querySelector('.cost-type-cards');
  const card = document.querySelector('.cost-type-card');
  const strong = card?.querySelector('strong');
  const toggle = document.querySelector('.toolbar-view-toggle');
  const tbl = document.querySelector('.table-toolbar');
  const g = grid ? getComputedStyle(grid) : null;
  return {
    gridBg: g?.backgroundColor, gridRadius: g?.borderTopLeftRadius,
    gridBorder: g ? `${g.borderTopWidth}/${g.borderBottomWidth}` : null,
    cols: g?.gridTemplateColumns,
    cardAlign: card ? getComputedStyle(card).alignItems : null,
    valueSize: strong ? getComputedStyle(strong).fontSize : null,
    valueWeight: strong ? getComputedStyle(strong).fontWeight : null,
    toggleH: toggle ? Math.round(toggle.getBoundingClientRect().height) : null,
    searchH: document.querySelector('.toolbar-search') ? Math.round(document.querySelector('.toolbar-search').getBoundingClientRect().height) : null,
    toolbarH: tbl ? Math.round(tbl.getBoundingClientRect().height) : null,
  };
});
console.log('=== /cost/costs ===');
console.log(JSON.stringify(m, null, 1));

const ds = await page.evaluate(() => {
  const c = document.querySelector('.ds-section-card:has(> .downstream-summary-grid)');
  return c ? { found: true } : { found: false };
});
console.log('downstream 区块外壳被清:', ds);
await browser.close();
