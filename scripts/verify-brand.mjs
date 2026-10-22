// 品牌印 4 套调色板 × 品牌名主题色 验证
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);
await gotoRoute(page, '/projects', { settle: 1500 });

const ICONS = ['ink', 'paper', 'jade', 'seal'];
const THEMES = ['warm-paper', 'plain-white', 'midnight'];

console.log('=== 品牌印调色板实测 ===');
for (const id of ICONS) {
  const r = await page.evaluate((iconId) => {
    // 直接改 dataset 触发 CSS，同时替换 svg 需要用 React 状态
    // 这里只验证 CSS 变量联动，图标本体由 React 控制
    document.documentElement.dataset.appIcon = iconId;
    const strong = document.querySelector('.sidebar-wordmark strong');
    const cs = strong ? getComputedStyle(strong) : null;
    return { wordmarkColor: cs ? cs.color : null, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() };
  }, id);
  console.log(`  ${id.padEnd(6)}  品牌名色 ${r.wordmarkColor}  --accent ${r.accent}`);
}

console.log('\n=== 品牌名跨主题 ===');
for (const t of THEMES) {
  const r = await page.evaluate((theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    const strong = document.querySelector('.sidebar-wordmark strong');
    const cs = strong ? getComputedStyle(strong) : null;
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return { color: cs ? cs.color : null, accent: acc };
  }, t);
  const ok = r.color && r.accent ? '✓' : '?';
  console.log(`  ${t.padEnd(13)} 品牌名 ${String(r.color).padEnd(28)} --accent ${r.accent} ${ok}`);
}

await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'warm-paper'));
await page.waitForTimeout(400);
await page.screenshot({ path: 'D:/WorkSpace/hana/moheng/docs/gates/brand-accent.png', clip: { x: 0, y: 0, width: 300, height: 120 } });

await browser.close();
