// 验证 position:relative 与 --duration-spinner 改动的影响
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

const ROUTES = ['/projects', '/cost/contracts', '/audit-logs', '/system/dictionaries'];

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

for (const route of ROUTES) {
  await gotoRoute(page, route, { settle: 1300 });

  const r = await page.evaluate(() => {
    const main = document.querySelector('.app-main');
    const cs = getComputedStyle(main);
    const out = {
      mainPosition: cs.position,
      // 找绝对定位后代，它们的包含块会受影响
      absDescendants: [],
      spinnerDur: null,
    };

    // 绝对/固定定位的后代，位置是否在 .app-main 内
    const mainRect = main.getBoundingClientRect();
    for (const el of main.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      if (s.position === 'absolute') {
        const b = el.getBoundingClientRect();
        // 只记录有实际尺寸的
        if (b.width > 1 && b.height > 1) {
          const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
          out.absDescendants.push({
            cls: el.tagName.toLowerCase() + (cls ? '.' + cls : ''),
            x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
            inMain: b.x >= mainRect.x - 2 && b.x + b.width <= mainRect.x + mainRect.width + 2,
          });
        }
      }
    }

    const sp = document.querySelector('.spinner');
    if (sp) {
      const ss = getComputedStyle(sp);
      out.spinnerDur = ss.animationDuration;
    }
    // 检查 --duration-spinner 是否解析
    out.spinnerToken = getComputedStyle(document.documentElement).getPropertyValue('--duration-spinner').trim();
    return out;
  });

  console.log(`\n=== ${route} ===`);
  console.log(`  .app-main position: ${r.mainPosition}`);
  console.log(`  --duration-spinner: "${r.spinnerToken}"${r.spinnerDur ? `  .spinner 实测 ${r.spinnerDur}` : ''}`);
  if (r.absDescendants.length) {
    console.log(`  绝对定位后代 ${r.absDescendants.length} 个:`);
    const outside = r.absDescendants.filter((d) => !d.inMain);
    for (const d of r.absDescendants.slice(0, 5)) {
      console.log(`    ${d.cls.padEnd(32)} ${d.w}x${d.h} @ (${d.x},${d.y}) ${d.inMain ? '' : '⚠ 超出主区'}`);
    }
    if (outside.length) console.log(`  ⚠ ${outside.length} 个超出主区边界`);
    else console.log(`  ✓ 全部在主区内`);
  } else {
    console.log('  无绝对定位后代');
  }
}

await browser.close();
