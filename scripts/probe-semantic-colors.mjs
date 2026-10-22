// 语义色主题检查：绿/橙/红状态在 4 套主题下是否跟着调整
// 深色主题下，给浅色主题调的 #2d926e 这类颜色会发暗难读
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

const THEMES = ['warm-paper', 'plain-white', 'midnight', 'high-contrast'];
const ROUTES = ['/audit-logs', '/cost/contracts', '/projects', '/system/accounts'];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
await assertApiUp();

for (const theme of THEMES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await login(page);
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForTimeout(500);

  const seen = new Map();
  for (const route of ROUTES) {
    await gotoRoute(page, route, { settle: 1000 });
    const badges = await page.evaluate(() => {
      const out = [];
      // 各种状态标签
      for (const el of document.querySelectorAll('.status-badge, .status-green, .status-orange, .status-red, .status-blue, .status-gray, .status-amber, .owner-status')) {
        const cs = getComputedStyle(el);
        const txt = (el.textContent || '').trim().slice(0, 8);
        if (!txt) continue;
        out.push({
          cls: (typeof el.className === 'string' ? el.className : '').replace(/status-badge\s*/, '').trim() || 'badge',
          color: cs.color,
          bg: cs.backgroundColor,
          text: txt,
        });
      }
      return out;
    });
    for (const b of badges) {
      const key = `${b.cls}|${b.text}`;
      if (!seen.has(key)) seen.set(key, b);
    }
  }

  console.log(`\n=== ${theme} ===`);
  // 按文字色分组，看有多少种
  const byColor = new Map();
  for (const b of seen.values()) {
    if (!byColor.has(b.color)) byColor.set(b.color, []);
    byColor.get(b.color).push(b.text);
  }
  for (const [color, texts] of byColor) {
    console.log(`  ${color.padEnd(24)} ${texts.slice(0, 4).join(' ')}${texts.length > 4 ? ` +${texts.length - 4}` : ''}`);
  }
  await ctx.close();
}
await browser.close();
