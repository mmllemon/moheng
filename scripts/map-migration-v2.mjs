// 修正分类精度：一个属性只有「在所有匹配元素上都被覆盖」才算已覆盖
// 之前的问题：同一条规则匹配多个元素时，A 元素覆盖、B 元素不覆盖，属性会同时进两个集合
import { chromium } from 'playwright-core';
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

const APPEARANCE = new Set([
  'height', 'min-height', 'max-height', 'width', 'min-width', 'max-width',
  'padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom',
  'padding-inline', 'padding-block', 'padding-inline-start', 'padding-inline-end',
  'border', 'border-width', 'border-style', 'border-color',
  'border-top', 'border-bottom', 'border-left', 'border-right',
  'border-top-width', 'border-bottom-width', 'border-left-width', 'border-right-width',
  'border-top-color', 'border-bottom-color', 'border-left-color', 'border-right-color',
  'border-radius', 'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-left-radius', 'border-bottom-right-radius',
  'background', 'background-color', 'background-image',
  'color', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'text-align', 'text-transform', 'white-space',
  'box-shadow', 'outline', 'outline-width', 'outline-style', 'outline-color', 'outline-offset',
  'opacity', 'visibility', 'display', 'position', 'z-index',
  'gap', 'row-gap', 'column-gap', 'align-items', 'justify-content', 'flex-direction',
  'grid-template-columns', 'grid-template-rows', 'flex', 'flex-wrap',
  'transform', 'transition', 'cursor', 'overflow', 'text-overflow',
  'appearance', 'backdrop-filter', 'filter',
]);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email]').first().fill('admin@local.test');
await page.locator('input[type=password]').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2600);

// 全局累积：规则 → 属性 → { total: 见过的元素数, covered: 被覆盖的元素数 }
const acc = new Map();

for (const route of ROUTES) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(840);

  const res = await page.evaluate((apList) => {
    const AP = new Set(apList);
    const rules = [];
    const walk = (list, sheetName) => {
      for (const rule of list) {
        if (rule.cssRules && !rule.selectorText) { walk(rule.cssRules, sheetName); continue; }
        if (!rule.selectorText) continue;
        if (!rule.style) continue;
        const decls = [];
        for (let i = 0; i < rule.style.length; i++) {
          const n = rule.style[i].toLowerCase();
          if (AP.has(n)) decls.push(n);
        }
        if (!decls.length) continue;
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

    const targets = rules.filter((r) => /legacy\.css|v6\.css/.test(r.sheet));
    const hanaRules = rules.filter((r) => /hana\.css/.test(r.sheet));
    const all = document.querySelectorAll('*');

    const out = [];
    for (const rule of targets) {
      const parts = rule.sel.split(',').map((s) => s.trim());
      // 属性 → { total, covered }
      const perProp = new Map();
      let hits = 0;

      for (const el of all) {
        if (/^(SCRIPT|STYLE|HTML|HEAD|META|LINK|TITLE)$/.test(el.tagName)) continue;
        let hit = false;
        for (const p of parts) {
          try { if (el.matches(p)) { hit = true; break; } } catch { }
        }
        if (!hit) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        hits++;
        if (hits > 400) break;

        const hanaProps = new Set();
        for (const h of hanaRules) {
          const hp = h.sel.split(',').map((s) => s.trim());
          let hhit = false;
          for (const p of hp) {
            try { if (el.matches(p)) { hhit = true; break; } } catch { }
          }
          if (hhit) for (const d of h.decls) hanaProps.add(d);
        }

        for (const d of rule.decls) {
          if (!perProp.has(d)) perProp.set(d, { total: 0, covered: 0 });
          const g = perProp.get(d);
          g.total++;
          if (hanaProps.has(d)) g.covered++;
        }
      }
      if (!hits) continue;
      out.push({
        sel: rule.sel, sheet: rule.sheet, hits,
        perProp: [...perProp.entries()].map(([k, v]) => [k, v.total, v.covered]),
      });
    }
    return out;
  }, [...APPEARANCE]);

  for (const r of res) {
    const key = `${r.sheet}|${r.sel}`;
    if (!acc.has(key)) acc.set(key, { sheet: r.sheet, sel: r.sel, hits: 0, perProp: new Map() });
    const g = acc.get(key);
    g.hits += r.hits;
    for (const [prop, total, covered] of r.perProp) {
      if (!g.perProp.has(prop)) g.perProp.set(prop, { total: 0, covered: 0 });
      const p = g.perProp.get(prop);
      p.total += total;
      p.covered += covered;
    }
  }
}

// 分类：属性「完全覆盖」= 该属性在所有出现过的元素上都被 hana 覆盖
const dead = [], partial = [], alive = [];
for (const g of acc.values()) {
  const fully = [];   // 全元素覆盖
  const partly = [];  // 部分元素覆盖
  const none = [];    // 完全没覆盖
  for (const [prop, v] of g.perProp) {
    if (v.covered === 0) none.push(prop);
    else if (v.covered === v.total) fully.push(prop);
    else partly.push(`${prop}(${v.covered}/${v.total})`);
  }
  const item = {
    sheet: g.sheet, sel: g.sel, hits: g.hits,
    declCount: g.perProp.size,
    fully, partly, none,
  };
  if (fully.length && !partly.length && !none.length) dead.push(item);
  else if (fully.length || partly.length) partial.push(item);
  else alive.push(item);
}

const pct = (n) => ((n / acc.size) * 100).toFixed(1);
console.log(`=== ${acc.size} 条规则（修正判据：属性需在所有匹配元素上都被覆盖）===\n`);
console.log(`  完全覆盖（可删）: ${String(dead.length).padStart(3)}  ${pct(dead.length)}%`);
console.log(`  部分覆盖（需接管）: ${String(partial.length).padStart(3)}  ${pct(partial.length)}%`);
console.log(`  完全未覆盖（保留）: ${String(alive.length).padStart(3)}  ${pct(alive.length)}%`);

writeFileSync('docs/gates/full-migration-map-v2.json', JSON.stringify({
  total: acc.size, dead, partial, alive,
}, null, 2));

// 对比 v1
const v1 = JSON.parse(require('node:fs').readFileSync('docs/gates/full-migration-map.json', 'utf8'));
console.log(`\n=== 与 v1 对比 ===`);
console.log(`  v1: dead ${v1.dead.length} / partial ${v1.partial.length} / alive ${v1.alive.length}`);
console.log(`  v2: dead ${dead.length} / partial ${partial.length} / alive ${alive.length}`);

console.log('\n→ docs/gates/full-migration-map-v2.json');
await browser.close();
