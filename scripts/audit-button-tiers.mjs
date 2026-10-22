// 文字按钮档位现状：确认 32 / 26 / 24 三档是否都还在用
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

const ROUTES = ['/projects', '/cost/contracts', '/audit-logs', '/system/accounts', '/system/dictionaries', '/parties', '/reports/studio'];

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

const tiers = new Map();

for (const route of ROUTES) {
  await gotoRoute(page, route, { settle: 1200 });
  const btns = await page.evaluate(() => {
    const out = [];
    for (const b of document.querySelectorAll('button.button, a.button')) {
      const cs = getComputedStyle(b);
      if (cs.display === 'none') continue;
      const r = b.getBoundingClientRect();
      const h = Math.round(r.height);
      if (h < 8) continue;
      out.push({
        h,
        cls: (b.className || '').toString().split(/\s+/).filter((c) => c !== 'button').slice(0, 2).join('.') || '(only .button)',
        text: (b.textContent || '').trim().slice(0, 12),
      });
    }
    return out;
  });
  for (const b of btns) {
    const k = `${b.h}px`;
    if (!tiers.has(k)) tiers.set(k, []);
    tiers.get(k).push({ route, ...b });
  }
}

console.log('=== 文字按钮高度档位 ===\n');
const sorted = [...tiers.entries()].sort((a, b) => parseInt(b[0]) - parseInt(a[0]));
for (const [h, items] of sorted) {
  const classes = [...new Set(items.map((i) => i.cls))];
  console.log(`${h.padEnd(8)} ${items.length} 个实例  出现在 ${new Set(items.map((i) => i.route)).size} 个路由`);
  console.log(`         类名: ${classes.slice(0, 5).join(', ')}${classes.length > 5 ? ` +${classes.length - 5}` : ''}`);
  console.log(`         示例: ${items.slice(0, 3).map((i) => `"${i.text}"`).join(' ')}`);
}

console.log(`\n共 ${sorted.length} 档：${sorted.map(([h]) => h).join(' / ')}`);
if (sorted.length === 3) {
  console.log('✓ 与脚本声明的三档一致');
} else {
  console.log(`⚠ 脚本声明三档，实测 ${sorted.length} 档`);
}

await browser.close();
