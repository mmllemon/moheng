// hana → moheng 视觉对账 v2：用「运行时真实类名」
// 教训：v1 拿 legacy/v6 的旧类名（.sidebar/.main-shell/.topbar）去比，
// 但真正生效的是 .app-sidebar/.app-main/.app-titlebar。找错对象下的结论全是错的。
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

const HANA = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35/styles.css';
const hanaCss = readFileSync(HANA, 'utf8');

function grab(text, selector) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim().replace(/\s+/g, ' ');
    if (t === `${selector} {` || t === `${selector}{`) {
      const d = {};
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith('}')) {
        const l = lines[j].trim();
        const idx = l.indexOf(':');
        if (idx > 0 && !l.startsWith('/*')) d[l.slice(0, idx).trim()] = l.slice(idx + 1).replace(/;.*/, '').trim();
        j++;
      }
      return d;
    }
  }
  return null;
}

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);
await gotoRoute(page, '/projects', { settle: 1500 });

// 采集 moheng 运行时真实值
const actual = await page.evaluate(() => {
  const g = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const cs = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      display: cs.display, position: cs.position, flexDirection: cs.flexDirection,
      width: cs.width, height: cs.height, zIndex: cs.zIndex,
      padding: cs.padding, margin: cs.margin, gap: cs.gap,
      background: cs.backgroundColor, borderRadius: cs.borderRadius,
      overflow: cs.overflow, minWidth: cs.minWidth, maxWidth: cs.maxWidth,
      font: cs.font, lineHeight: cs.lineHeight, fontSize: cs.fontSize,
    };
  };
  return {
    appShell: g('.app-shell'),
    appSidebar: g('.app-sidebar'),
    sideTitlebar: g('.app-sidebar-titlebar'),
    sideProfile: g('.app-sidebar-profile'),
    sideScroll: g('.app-sidebar-scroll'),
    sideFooter: g('.app-sidebar-footer'),
    appMain: g('.app-main'),
    appTitlebar: g('.app-titlebar'),
    appContent: g('.app-content'),
    pageWrap: g('.page-wrap'),
    body: g('body'),
    navLink: g('.sidebar-nav-group a'),
    iconBtn: g('.sidebar-toggle'),
    profileBtn: g('.sidebar-profile-action'),
  };
});

await browser.close();

// hana 侧
const H = {
  body: grab(hanaCss, 'body') || {},
  app: grab(hanaCss, '.app') || {},
  sidebar: grab(hanaCss, '.sidebar') || {},
  sidebarInner: grab(hanaCss, '.sidebar-inner') || {},
  sidebarHeader: grab(hanaCss, '.sidebar-header') || {},
  sidebarFooter: grab(hanaCss, '.sidebar-footer') || {},
  mainContent: grab(hanaCss, '.main-content') || {},
  titlebar: grab(hanaCss, '.titlebar') || {},
  iconBtn: grab(hanaCss, '.sidebar-action-btn') || {},
};

console.log('hana 骨架对应关系\n');
const pairs = [
  { name: '根容器', hana: ['.app', H.app], mo: [' .app-shell', actual.appShell], note: 'hana .app = flex row' },
  { name: '侧栏', hana: ['.sidebar', H.sidebar], mo: [' .app-sidebar', actual.appSidebar] },
  { name: '侧栏内层', hana: ['.sidebar-inner', H.sidebarInner], mo: [' .app-sidebar-scroll', actual.sideScroll], note: 'hana 有内层包裹，moheng 直接分三段' },
  { name: '侧栏头', hana: ['.sidebar-header', H.sidebarHeader], mo: [' .app-sidebar-titlebar', actual.sideTitlebar] },
  { name: '侧栏底', hana: ['.sidebar-footer', H.sidebarFooter], mo: [' .app-sidebar-footer', actual.sideFooter] },
  { name: '主区', hana: ['.main-content', H.mainContent], mo: [' .app-main', actual.appMain] },
  { name: '顶栏', hana: ['.titlebar', H.titlebar], mo: [' .app-titlebar', actual.appTitlebar] },
  { name: '图标按钮', hana: ['.sidebar-action-btn', H.iconBtn], mo: [' .sidebar-toggle', actual.iconBtn] },
];

for (const p of pairs) {
  const [hs, hd] = p.hana;
  const [ms, md] = p.mo;
  console.log(`【${p.name}】  hana ${hs}  ↔  moheng ${ms}`);
  if (p.note) console.log(`  ${p.note}`);
  if (!md) { console.log('  moheng 未找到\n'); continue; }

  const checks = [
    ['display', hd.display, md.display],
    ['position', hd.position, md.position],
    ['flex-direction', hd['flex-direction'], md.flexDirection],
    ['width', hd.width, md.width],
    ['height', hd.height, md.height],
    ['z-index', hd['z-index'], md.zIndex],
    ['padding', hd.padding, md.padding],
    ['gap', hd.gap, md.gap],
    ['overflow', hd.overflow, md.overflow],
  ];
  let same = 0, diff = 0;
  const rows = [];
  for (const [k, a, b] of checks) {
    if (a === undefined) continue;
    const an = String(a).replace(/\s+/g, '');
    const bn = String(b).replace(/\s+/g, '');
    if (an === bn) { same++; } else { diff++; rows.push(`  ${k.padEnd(15)} hana=${String(a).padEnd(26)} moheng=${b}`); }
  }
  const size = `实测 ${md.w}x${md.h}`;
  console.log(`  ${size}  |  相同 ${same} / 不同 ${diff}`);
  for (const r of rows) console.log(r);
  console.log('');
}
