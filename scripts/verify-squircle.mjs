// 修正后的 squircle 验证：Chrome 155 把 squircle 计算成 superellipse(2)
import { chromium } from 'playwright-core';

import { login } from './_harness.mjs';
const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
await login(page);

const out = {};
for (const route of ['/', '/settings/appearance', '/cost/contracts', '/system/accounts']) {
  await page.goto(BASE + route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  out[route] = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('body *')).filter((el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 20 && s.display !== 'none' && s.visibility !== 'hidden';
    });
    const shapes = {};
    let plainRadius = 0;
    for (const el of els) {
      const s = getComputedStyle(el);
      const shape = s.getPropertyValue('corner-shape').trim();
      const br = parseFloat(s.borderRadius);
      if (!br || br <= 0) continue;
      if (!shape || shape === 'round') {
        if (br > 4) plainRadius++;
        shapes[shape || '(none)'] = (shapes[shape || '(none)'] || 0) + 1;
      } else {
        shapes[shape] = (shapes[shape] || 0) + 1;
      }
    }
    return { shapes, plainRadius };
  });
}
console.log(JSON.stringify(out, null, 2));
await browser.close();
