// 四种品牌印色板截图对比
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

const cases = [
  { icon: 'ink', theme: 'warm-paper' },
  { icon: 'paper', theme: 'warm-paper' },
  { icon: 'jade', theme: 'warm-paper' },
  { icon: 'seal', theme: 'warm-paper' },
  { icon: 'ink', theme: 'midnight' },
];

for (const c of cases) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await login(page);

  // 通过 store 设图标（zustand 暴露到 window 才可靠，改用 localStorage 方式）
  await page.evaluate((icon) => {
    const KEY = 'moheng:ui-preferences';
    let cur = {};
    try { cur = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { cur = {}; }
    localStorage.setItem(KEY, JSON.stringify({ ...cur, appIcon: icon }));
  }, c.icon);

  await page.reload({ waitUntil: 'networkidle' });
  await gotoRoute(page, '/projects', { settle: 1500 });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), c.theme);
  await page.waitForTimeout(500);

  const info = await page.evaluate(() => {
    const svg = document.querySelector('.sidebar-brand-mark svg rect');
    return {
      icon: document.documentElement.dataset.appIcon,
      rectFill: svg ? svg.getAttribute('fill') : null,
      nameColor: getComputedStyle(document.querySelector('.sidebar-wordmark strong')).color,
    };
  });

  const file = `D:/WorkSpace/hana/moheng/docs/gates/brand-${c.icon}-${c.theme}.png`;
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 280, height: 110 } });
  console.log(`${c.icon.padEnd(6)} ${c.theme.padEnd(12)} 底=${info.rectFill}  名=${info.nameColor}`);

  await ctx.close();
}

await browser.close();
