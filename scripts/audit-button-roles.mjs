// moheng 按钮实际渲染规格采集：按视觉角色分类
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ROUTES = [
  '/', '/projects', '/cost/contracts', '/cost/budget', '/cost/progress-bills',
  '/cost/changes', '/cost/downstream', '/cost/owner-finance', '/cost/costs',
  '/cost/analysis', '/reports', '/notifications', '/parties', '/audit-logs',
  '/settings/appearance', '/system', '/system/accounts', '/system/dictionaries',
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email]').first().fill('admin@local.test');
await page.locator('input[type=password]').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2600);

const rows = [];
for (const route of ROUTES) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(900);

  const items = await page.evaluate(() => {
    const out = [];
    const sels = 'button, [role=button], .button, .icon-button, .table-action, .toolbar-view-toggle button, a.button';
    const seen = new Set();
    for (const el of document.querySelectorAll(sels)) {
      if (seen.has(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.height < 8 || r.width < 8) continue;
      // 判断视觉角色
      const cls = (el.className || '').toString();
      const isIcon = /icon-button|table-action|close/i.test(cls) || (!el.textContent.trim() && !!el.querySelector('svg'));
      const isPrimary = /primary/.test(cls);
      const isGhost = /ghost|quiet|link/.test(cls);
      const inRow = !!el.closest('td, tr, .row-actions');
      const inHead = !!el.closest('.page-actions, .table-heading-actions, .ds-section-actions');
      const isSeg = !!el.closest('.toolbar-view-toggle, .segmented, [role=tablist]');
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: cls.slice(0, 50),
        text: (el.textContent || '').trim().slice(0, 8),
        h: Math.round(r.height),
        w: Math.round(r.width),
        square: Math.abs(r.width - r.height) <= 3,
        pad: cs.padding,
        fs: cs.fontSize,
        fw: cs.fontWeight,
        radius: cs.borderTopLeftRadius,
        gap: cs.gap,
        border: cs.borderTopWidth,
        isIcon, isPrimary, isGhost, inRow, inHead, isSeg,
        hasSvg: !!el.querySelector('svg'),
      });
    }
    return out;
  });
  for (const it of items) rows.push({ route, ...it });
}

console.log(`=== ${rows.length} 个按钮实例 ===\n`);

const role = (r) => {
  if (r.isIcon) return '图标按钮';
  if (r.isSeg) return '分段控件';
  if (r.isPrimary) return '主按钮';
  if (r.isGhost) return '次/幽灵按钮';
  return '普通按钮';
};

const roles = ['主按钮', '次/幽灵按钮', '普通按钮', '图标按钮', '分段控件'];
for (const R of roles) {
  const list = rows.filter((r) => role(r) === R);
  if (!list.length) continue;
  const h = new Map(), f = new Map(), p = new Map(), rad = new Map();
  for (const r of list) {
    h.set(r.h, (h.get(r.h) || 0) + 1);
    f.set(`${r.fs}/${r.fw}`, (f.get(`${r.fs}/${r.fw}`) || 0) + 1);
    p.set(r.pad, (p.get(r.pad) || 0) + 1);
    rad.set(r.radius, (rad.get(r.radius) || 0) + 1);
  }
  const fmt = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}(${n})`).join('  ');
  console.log(`### ${R}  ${list.length} 个`);
  console.log(`   高度: ${fmt(h)}`);
  console.log(`   字号/字重: ${fmt(f)}`);
  console.log(`   padding: ${fmt(p)}`);
  console.log(`   圆角: ${fmt(rad)}`);
  console.log('');
}

// 图标按钮专项
const icons = rows.filter((r) => r.isIcon);
console.log('=== 图标按钮详细 ===');
const sq = icons.filter((r) => r.square).length;
console.log(`  ${icons.length} 个，其中正方形 ${sq} 个`);
const ih = new Map();
for (const r of icons) ih.set(r.h, (ih.get(r.h) || 0) + 1);
for (const [k, n] of [...ih.entries()].sort((a, b) => a[0] - b[0])) console.log(`  ${String(k).padStart(3)}px  ${n}`);

await browser.close();
