// 顶栏文字规格 vs hana，以及跨主题表现
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);
await gotoRoute(page, '/projects', { settle: 1500 });

const SEL = {
  页面名: '.titlebar-context strong',
  项目编码: '.titlebar-project-code',
  全局范围: '.titlebar-global-scope',
  顶栏容器: '.app-titlebar',
  图标按钮: '.titlebar-icon',
  头像: '.titlebar-avatar',
};

const THEMES = ['warm-paper', 'plain-white', 'midnight'];

for (const t of THEMES) {
  await page.evaluate((th) => document.documentElement.setAttribute('data-theme', th), t);
  await page.waitForTimeout(400);
  const r = await page.evaluate((sel) => {
    const out = {};
    for (const [k, s] of Object.entries(sel)) {
      const e = document.querySelector(s);
      if (!e) { out[k] = null; continue; }
      const cs = getComputedStyle(e);
      out[k] = {
        fs: cs.fontSize, color: cs.color, weight: cs.fontWeight,
        ls: cs.letterSpacing, bg: cs.backgroundColor,
      };
    }
    out.__vars = {
      bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      text: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),
      textMuted: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim(),
      textLight: getComputedStyle(document.documentElement).getPropertyValue('--text-light').trim(),
      overlayLight: getComputedStyle(document.documentElement).getPropertyValue('--overlay-light').trim(),
    };
    return out;
  }, SEL);

  console.log(`\n=== ${t} ===`);
  console.log(`  --bg ${r.__vars.bg}  --text ${r.__vars.text}  --text-muted ${r.__vars.textMuted}`);
  console.log(`  --text-light ${r.__vars.textLight}  --overlay-light ${r.__vars.overlayLight}`);
  for (const k of Object.keys(SEL)) {
    const v = r[k];
    if (!v) { console.log(`  ${k.padEnd(10)}(不存在)`); continue; }
    console.log(`  ${k.padEnd(10)}${String(v.fs).padEnd(9)}${String(v.color).padEnd(28)}w${v.weight}  ls=${v.ls}`);
  }
}

await browser.close();
