// 验证真实页面的标题/正文在修正声明后的实际渲染字重
import { chromium } from 'playwright-core';

import { login } from './_harness.mjs';
const BASE = 'http://localhost:5173';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
await login(p);

await p.goto(BASE + '/projects', { waitUntil: 'networkidle' });
await p.waitForTimeout(700);

const info = await p.evaluate(() => {
  const h1 = document.querySelector('.page-header h1');
  const body = document.querySelector('.page-wrap p, .data-table td');
  const pick = (el) => el ? {
    text: (el.textContent || '').slice(0, 16),
    weight: getComputedStyle(el).fontWeight,
    family: getComputedStyle(el).fontFamily.split(',')[0],
    size: getComputedStyle(el).fontSize,
  } : null;
  return { heading: pick(h1), body: pick(body) };
});

// 截一张标题区域特写，供人工比对
await p.screenshot({ path: 'docs/gates/heading-weight.png', clip: { x: 260, y: 40, width: 900, height: 220 } });

console.log(JSON.stringify(info, null, 2));
await b.close();
