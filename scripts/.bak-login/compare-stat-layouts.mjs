// 对比三个页面的统计卡容器结构，验证视觉不统一的具体原因
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email]').first().fill('admin@local.test');
await page.locator('input[type=password]').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2600);

const ROUTES = {
  '进度款(图1)': '/cost/progress-bills',
  '竣工结算(图2)': '/cost/owner-finance',
  '分供合同(图3)': '/cost/downstream',
  '变更签证': '/cost/changes',
};

for (const [name, route] of Object.entries(ROUTES)) {
  await page.goto(BASE + route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1100);

  const info = await page.evaluate(() => {
    // 找统计卡容器（grid）和卡片
    const grids = [...document.querySelectorAll('[class*="summary-grid"], [class*="metrics"]')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 30 && el.querySelector('strong');
    });
    const out = [];
    for (const g of grids) {
      const gcs = getComputedStyle(g);
      const gr = g.getBoundingClientRect();
      const card = g.firstElementChild;
      const ccs = card ? getComputedStyle(card) : null;
      // 卡片是否有图标
      const hasIcon = card ? !!card.querySelector('svg, .bill-summary-icon, [class*="icon"]') : false;
      // 卡片内文本对齐
      const label = card ? card.querySelector('span, small') : null;
      const labelAlign = label ? getComputedStyle(label).textAlign : null;
      // 图标是否居中
      const iconEl = card ? card.querySelector('svg, [class*="icon"]') : null;
      const iconParentAlign = iconEl && iconEl.parentElement ? getComputedStyle(iconEl.parentElement).alignItems : null;

      out.push({
        gridCls: (g.className || '').toString().slice(0, 60),
        gridW: Math.round(gr.width),
        gridH: Math.round(gr.height),
        gridBg: gcs.backgroundColor.slice(0, 24),
        gridBorder: gcs.borderTopWidth + ' ' + gcs.borderTopStyle,
        gridRadius: gcs.borderTopLeftRadius,
        gridPadding: gcs.padding,
        cardCls: card ? (card.className || '').toString().slice(0, 40) : null,
        cardDisplay: ccs ? ccs.display : null,
        cardFlexDir: ccs ? ccs.flexDirection : null,
        cardAlignItems: ccs ? ccs.alignItems : null,
        cardTextAlign: ccs ? ccs.textAlign : null,
        hasIcon,
        iconParentAlign,
        labelAlign,
        childCount: g.children.length,
      });
    }
    return out;
  });

  console.log(`\n===== ${name} ${route} =====`);
  for (const i of info) console.log(JSON.stringify(i, null, 1));
}
await browser.close();
