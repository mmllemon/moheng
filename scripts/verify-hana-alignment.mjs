// 验证 P0/P1 改动是否真的生效：squircle 覆盖、阴影 token、字重、对比度档位
import { chromium } from 'playwright-core';

import { login } from './_harness.mjs';
const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

const report = {};
for (const route of ['/', '/settings/appearance', '/cost/contracts', '/system/accounts']) {
  await page.goto(BASE + route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  report[route] = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('body *')).filter((el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 20 && s.display !== 'none' && s.visibility !== 'hidden';
    });
    let squircle = 0;
    let round = 0;
    let radiusOnly = 0;
    for (const el of els) {
      const s = getComputedStyle(el);
      const shape = s.getPropertyValue('corner-shape').trim();
      const br = parseFloat(s.borderRadius);
      if (!br || br <= 0) continue;
      if (shape === 'squircle') squircle++;
      else if (shape === 'round') round++;
      else if (br > 4) radiusOnly++;
    }
    const supportsCornerShape = CSS.supports('corner-shape', 'squircle');
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      squircle, round, radiusOnly, supportsCornerShape,
      scale: rootStyle.getPropertyValue('--corner-radius-scale').trim(),
      shadowToken: rootStyle.getPropertyValue('--shadow').trim(),
      textInk: rootStyle.getPropertyValue('--text').trim(),
      contentInk: rootStyle.getPropertyValue('--content-ink').trim() || '(未设置=默认档)',
      contrastAttr: document.documentElement.dataset.contentContrast ?? '(无=13档)',
    };
  });
}

// 标题字体真实字重验证：渲染一个 700 字重的标题，量宽度差异
const fontCheck = await page.evaluate(async () => {
  await document.fonts.ready;
  const probe = document.createElement('span');
  probe.textContent = '墨衡工程经营';
  probe.style.cssText = 'position:absolute;left:-9999px;font-family:"MH Serif SC";font-size:40px;white-space:nowrap;';
  document.body.appendChild(probe);
  const widths = {};
  for (const w of [300, 400, 500, 600, 700]) {
    probe.style.fontWeight = String(w);
    widths[w] = probe.getBoundingClientRect().width;
  }
  probe.remove();
  const loaded = Array.from(document.fonts).filter((f) => f.family.includes('MH Serif SC') && f.status === 'loaded').length;
  return { widths, loadedFaces: loaded, distinctWidths: new Set(Object.values(widths).map((w) => w.toFixed(1))).size };
});

// 对比度档位切换验证
const contrastSwitch = await page.evaluate(async () => {
  const root = document.documentElement;
  const before = getComputedStyle(document.body).color;
  root.dataset.contentContrast = '17';
  await new Promise((r) => setTimeout(r, 60));
  const after = getComputedStyle(document.body).color;
  root.removeAttribute('data-content-contrast');
  return { before, after, changed: before !== after };
});

console.log(JSON.stringify({ routes: report, fontCheck, contrastSwitch }, null, 2));
await browser.close();
