// 图标按钮 -lg 档影响面基线：改 32→26 之前先记录全部实例
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

const ROUTES = ['/projects', '/cost/contracts', '/audit-logs', '/system/accounts', '/system/dictionaries'];

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

const all = new Map();

for (const route of ROUTES) {
  await gotoRoute(page, route, { settle: 1300 });
  const found = await page.evaluate(() => {
    const sels = ['.sidebar-toggle', '.sidebar-footer-icon', '.titlebar-icon', '.settings-close', '.settings-close-floating', '.sidebar-profile-action', '.sidebar-project-all'];
    const out = [];
    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        const r = el.getBoundingClientRect();
        if (r.width < 1) continue;
        out.push({
          sel: s,
          w: Math.round(r.width),
          h: Math.round(r.height),
          x: Math.round(r.x),
          y: Math.round(r.y),
          visible: getComputedStyle(el).display !== 'none',
        });
      }
    }
    return out;
  });
  for (const f of found) {
    const key = `${f.sel}|${f.w}x${f.h}`;
    if (!all.has(key)) all.set(key, { ...f, routes: [] });
    all.get(key).routes.push(route);
  }
}

console.log('=== -lg 档及相关图标按钮实测（1440px）===\n');
const bySel = new Map();
for (const v of all.values()) {
  if (!bySel.has(v.sel)) bySel.set(v.sel, []);
  bySel.get(v.sel).push(v);
}
for (const [sel, items] of bySel) {
  console.log(`${sel}`);
  for (const it of items) {
    console.log(`   ${it.w}x${it.h} @(${it.x},${it.y})  出现于 ${it.routes.length} 个路由`);
  }
}

// 侧栏头总高与按钮关系
await gotoRoute(page, '/projects', { settle: 1200 });
const headInfo = await page.evaluate(() => {
  const tb = document.querySelector('.app-sidebar-titlebar');
  const cs = getComputedStyle(tb);
  const toggles = [...document.querySelectorAll('.app-sidebar-titlebar .sidebar-toggle')];
  const tr = tb.getBoundingClientRect();
  return {
    h: Math.round(tr.height),
    padding: cs.padding,
    gap: cs.gap,
    toggleW: toggles.length ? Math.round(toggles[0].getBoundingClientRect().width) : null,
    toggleCount: toggles.length,
    appTitlebarH: Math.round(document.querySelector('.app-titlebar').getBoundingClientRect().height),
    footerH: Math.round(document.querySelector('.app-sidebar-footer').getBoundingClientRect().height),
  };
});
console.log('\n=== 侧栏头 vs 顶栏 ===');
console.log(`  侧栏头 ${headInfo.h}px  padding=${headInfo.padding}  gap=${headInfo.gap}`);
console.log(`  按钮 ${headInfo.toggleCount} × ${headInfo.toggleW}px`);
console.log(`  顶栏 ${headInfo.appTitlebarH}px`);
console.log(`  侧栏脚 ${headInfo.footerH}px`);

console.log('\n=== 改为 26px + padding 8px 16px 后 ===');
const newH = 8 + 26 + 8;
console.log(`  侧栏头 ${headInfo.h} → ${newH}px`);
console.log(`  与顶栏差 ${headInfo.appTitlebarH - newH}px（hana 也是矮 2px）`);
console.log(`  按钮 ${headInfo.toggleW} → 26px（-${headInfo.toggleW - 26}）`);

await browser.close();
