// 系统设置页深度诊断：找出禁用旧层后具体哪些元素塌陷
import { chromium } from 'playwright-core';

import { login } from './_harness.mjs';
const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

for (const route of ['/settings/appearance', '/system/accounts', '/system/parameters']) {
  await page.goto(BASE + route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const info = await page.evaluate(() => {
    const out = { url: location.pathname, elements: [] };
    // 采集设置区内所有直接子块
    const content = document.querySelector('.settings-content');
    if (content) {
      const walk = (el, depth = 0) => {
        if (depth > 2) return;
        for (const child of el.children) {
          const r = child.getBoundingClientRect();
          const cs = getComputedStyle(child);
          if (r.width === 0 && r.height === 0) continue;
          out.elements.push({
            tag: child.tagName.toLowerCase(),
            cls: (child.className || '').toString().slice(0, 50),
            w: Math.round(r.width), h: Math.round(r.height),
            display: cs.display,
            bg: cs.backgroundColor,
            border: cs.borderTopWidth,
            padding: cs.padding,
            gridCols: cs.gridTemplateColumns.slice(0, 40),
          });
          walk(child, depth + 1);
        }
      };
      walk(content);
    }
    return out;
  });

  console.log('=== ' + route + ' ===');
  console.log(JSON.stringify(info.elements.slice(0, 14), null, 1));
}
await browser.close();
