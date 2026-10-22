// 修正版：只统计「真正影响控件外观」的属性，排除 font 简写展开的噪音
import { chromium } from 'playwright-core';
import { login } from './_harness.mjs';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ROUTES = [
  '/', '/projects', '/projects/members', '/cost/contracts', '/cost/budget',
  '/cost/progress-bills', '/cost/changes', '/cost/downstream', '/cost/owner-finance',
  '/cost/costs', '/cost/analysis', '/reports', '/reports/designer', '/notifications',
  '/parties', '/audit-logs', '/settings/appearance', '/system', '/system/security',
  '/system/policies', '/system/governance', '/system/operations',
  '/system/dictionaries', '/system/parameters', '/system/accounts',
  '/system/assistant', '/account/security',
];

// 真正决定控件外观的属性白名单
const APPEARANCE = new Set([
  'height', 'min-height', 'max-height', 'width', 'min-width', 'max-width',
  'padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom',
  'padding-inline', 'padding-block',
  'border', 'border-width', 'border-style', 'border-color', 'border-top', 'border-bottom',
  'border-left', 'border-right', 'border-top-width', 'border-bottom-width',
  'border-left-width', 'border-right-width', 'border-top-color', 'border-bottom-color',
  'border-radius', 'background', 'background-color', 'color',
  'font-size', 'font-weight', 'line-height', 'text-align',
  'box-shadow', 'outline', 'outline-width', 'outline-style', 'outline-color',
  'outline-offset', 'appearance', 'transition', 'cursor', 'opacity',
  'display', 'align-items', 'justify-content', 'gap', 'flex', 'flex-direction',
  'letter-spacing', 'white-space', 'text-overflow',
]);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

const findings = [];

for (const route of ROUTES) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(840);

  const res = await page.evaluate((appearanceList) => {
    const APPEARANCE = new Set(appearanceList);
    const out = [];

    const rules = [];
    const walk = (list, sheetName) => {
      for (const rule of list) {
        if (rule.cssRules && !rule.selectorText) { walk(rule.cssRules, sheetName); continue; }
        if (!rule.selectorText) continue;
        const low = rule.selectorText.toLowerCase();
        if (!/(input|select|textarea|\.field|\.form-stack|\.form-grid|\.toolbar-search|\.select-control|\.date-picker)/.test(low)) continue;
        const decls = new Set();
        for (let i = 0; i < rule.style.length; i++) {
          const n = rule.style[i].toLowerCase();
          if (APPEARANCE.has(n)) decls.add(n);       // 只保留外观属性
        }
        if (!decls.size) continue;
        rules.push({ sel: rule.selectorText.replace(/\s+/g, ' '), sheet: sheetName, decls });
      }
    };
    for (const sheet of document.styleSheets) {
      let list;
      try { list = sheet.cssRules; } catch { continue; }
      if (!list) continue;
      const id = (sheet.ownerNode && sheet.ownerNode.getAttribute && sheet.ownerNode.getAttribute('data-vite-dev-id')) || '';
      walk(list, id.split('/').pop() || 'inline');
    }

    const sel = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]), select, textarea';
    for (const el of document.querySelectorAll(sel)) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.height < 4) continue;

      const matched = rules.filter((rule) =>
        rule.sel.split(',').map((s) => s.trim()).some((p) => { try { return el.matches(p); } catch { return false; } })
      );
      if (!matched.length) continue;

      const bySheet = { hana: new Set(), legacy: new Set(), v6: new Set(), other: new Set() };
      for (const m of matched) {
        const key = m.sheet.includes('hana') ? 'hana' : m.sheet.includes('legacy') ? 'legacy' : m.sheet.includes('v6') ? 'v6' : 'other';
        for (const p of m.decls) bySheet[key].add(p);
      }

      // 「旧层独有」= legacy/v6 声明了该外观属性，而 hana 完全没声明
      const legacyOnly = [];
      for (const sk of ['legacy', 'v6']) {
        for (const p of bySheet[sk]) {
          if (!bySheet.hana.has(p)) legacyOnly.push(`${sk}:${p}`);
        }
      }

      const owner = el.closest('.field, .form-stack, .form-grid, .toolbar-search, .select-control, .date-picker, .filter-bar, .dialog, .system-policy-form, .settings-row, .checkbox-line, .system-dictionary-item-fields');
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 34),
        owner: owner ? ((owner.className || '').toString().split(' ')[0] || owner.tagName.toLowerCase()) : '(裸)',
        legacyOnly,
      });
    }
    return out;
  }, [...APPEARANCE]);

  for (const r of res) findings.push({ route, ...r });
}

const byOwner = new Map();
for (const f of findings) {
  if (!byOwner.has(f.owner)) byOwner.set(f.owner, { owner: f.owner, total: 0, risky: 0, props: new Map() });
  const g = byOwner.get(f.owner);
  g.total++;
  if (f.legacyOnly.length) {
    g.risky++;
    for (const p of f.legacyOnly) g.props.set(p, (g.props.get(p) || 0) + 1);
  }
}

console.log(`=== ${findings.length} 个输入控件（只统计外观属性）===\n`);
const rows = [...byOwner.values()].sort((a, b) => b.total - a.total);
for (const r of rows) {
  const mark = r.risky === 0 ? '✓ 可迁' : r.risky === r.total ? '✗ 全依赖' : '△ 部分';
  console.log(`${mark.padEnd(9)} ${r.owner.padEnd(30)} ${String(r.risky).padStart(3)}/${String(r.total).padStart(3)}`);
  if (r.props.size) {
    const top = [...r.props.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}×${v}`);
    console.log(`           ${top.join('  ')}`);
  }
}

const safe = rows.filter((r) => r.risky === 0);
const unsafe = rows.filter((r) => r.risky > 0);
console.log(`\n可迁容器: ${safe.length} 个 / ${safe.reduce((a, b) => a + b.total, 0)} 控件`);
console.log(`依赖旧层: ${unsafe.length} 个 / ${unsafe.reduce((a, b) => a + b.total, 0)} 控件`);

writeFileSync('docs/gates/input-migration-classification.json', JSON.stringify({
  total: findings.length,
  safe: safe.map((r) => ({ owner: r.owner, controls: r.total })),
  unsafe: unsafe.map((r) => ({ owner: r.owner, risky: r.risky, total: r.total, props: [...r.props.keys()] })),
}, null, 2));

await browser.close();
