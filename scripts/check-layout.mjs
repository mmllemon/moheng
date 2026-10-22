// 修复后验证：布局是否恢复正常
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);
await gotoRoute(page, '/projects', { settle: 1500 });

const r = await page.evaluate(() => {
  const g = (s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const c = getComputedStyle(e);
    const b = e.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), disp: c.display, dir: c.flexDirection, pos: c.position };
  };
  return {
    shell: g('.app-shell'),
    sidebar: g('.app-sidebar'),
    main: g('.app-main'),
    titlebar: g('.app-titlebar'),
    content: g('.app-content'),
  };
});

console.log('=== 布局实测 ===');
for (const [k, v] of Object.entries(r)) {
  if (!v) { console.log(`${k}: (不存在)`); continue; }
  console.log(`${k.padEnd(10)} x=${String(v.x).padStart(4)} y=${String(v.y).padStart(3)} ${v.w}x${v.h}  ${v.disp}/${v.dir}  ${v.pos}`);
}

await browser.close();
