// 全量分类：legacy / v6 里每条规则，判定 hana.css 是否已完全覆盖它
// 判据：规则声明的每个「外观属性」，hana.css 是否在「同样能匹配到该元素」的规则里也声明了
// 输出：完全被覆盖（可删）/ 部分覆盖（需接管）/ 未被覆盖（必须保留）
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

// 外观属性白名单：只统计真正看得见的
const APPEARANCE = [
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
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

// 累积：规则 → 它在多少元素上「有属性被 hana 覆盖 / 未被覆盖」
const ruleStats = new Map(); // key: sheet|sel → { sheet, sel, decls:[], coveredProps:Set, uncoveredProps:Set, hits }

for (const route of ROUTES) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(840);

  const res = await page.evaluate((appearanceList) => {
    const AP = new Set(appearanceList);
    const rules = [];
    const walk = (list, sheetName) => {
      for (const rule of list) {
        if (rule.cssRules && !rule.selectorText) { walk(rule.cssRules, sheetName); continue; }
        if (!rule.selectorText) continue;
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

    // 只分析 legacy / v6
    const targets = rules.filter((r) => /legacy\.css|v6\.css/.test(r.sheet));
    const hanaRules = rules.filter((r) => /hana\.css/.test(r.sheet));

    const out = [];
    // 遍历所有可见元素，判断每条目标规则在其匹配元素上是否被 hana 覆盖
    const all = document.querySelectorAll('*');
    const matchedCache = new Map();

    for (const rule of targets) {
      const parts = rule.sel.split(',').map((s) => s.trim());
      let hits = 0;
      const coveredProps = new Set();
      const uncoveredProps = new Set();

      for (const el of all) {
        // 只处理有尺寸的元素
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'HTML' || el.tagName === 'HEAD') continue;
        let hit = false;
        for (const p of parts) {
          try { if (el.matches(p)) { hit = true; break; } } catch { }
        }
        if (!hit) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        hits++;
        if (hits > 400) break; // 单条规则采样上限

        // 该元素上，哪些 hana 规则也匹配
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
          if (hanaProps.has(d)) coveredProps.add(d);
          else uncoveredProps.add(d);
        }
      }
      if (hits === 0) continue;
      out.push({ sel: rule.sel, sheet: rule.sheet, hits, covered: [...coveredProps], uncovered: [...uncoveredProps] });
    }
    return out;
  }, APPEARANCE);

  for (const r of res) {
    const key = `${r.sheet}|${r.sel}`;
    if (!ruleStats.has(key)) {
      ruleStats.set(key, { sheet: r.sheet, sel: r.sel, hits: 0, covered: new Set(), uncovered: new Set() });
    }
    const g = ruleStats.get(key);
    g.hits += r.hits;
    for (const p of r.covered) g.covered.add(p);
    for (const p of r.uncovered) g.uncovered.add(p);
  }
}

// 分类
const buckets = { dead: [], partial: [], alive: [] };
for (const g of ruleStats.values()) {
  // 属性是否「真的被覆盖」：未被覆盖集合为空
  const hasUncovered = g.uncovered.size > 0;
  const hasCovered = g.covered.size > 0;
  const item = {
    sheet: g.sheet,
    sel: g.sel,
    hits: g.hits,
    declCount: g.covered.size + g.uncovered.size,
    uncovered: [...g.uncovered],
    covered: [...g.covered],
  };
  if (!hasUncovered && hasCovered) buckets.dead.push(item);
  else if (hasCovered) buckets.partial.push(item);
  else buckets.alive.push(item);
}

const pct = (n) => ((n / ruleStats.size) * 100).toFixed(1);
console.log(`=== 共分析 ${ruleStats.size} 条 legacy/v6 外观规则 ===\n`);
console.log(`  完全被 hana 覆盖（可删）: ${buckets.dead.length}  ${pct(buckets.dead.length)}%`);
console.log(`  部分覆盖（需接管）:       ${buckets.partial.length}  ${pct(buckets.partial.length)}%`);
console.log(`  完全未被覆盖（保留）:     ${buckets.alive.length}  ${pct(buckets.alive.length)}%`);

// 抽样展示
const show = (title, list, limit = 18) => {
  console.log(`\n--- ${title} ---`);
  if (!list.length) { console.log('  （无）'); return; }
  for (const x of list.slice(0, limit)) {
    console.log(`  [${x.sheet.replace('.css', '')}] ${x.sel.slice(0, 84)}`);
    if (x.uncovered.length) console.log(`      未覆盖: ${x.uncovered.slice(0, 8).join(' ')}`);
  }
  if (list.length > limit) console.log(`  ... 还有 ${list.length - limit} 条`);
};

show('完全被覆盖（可删候选）', buckets.dead.sort((a, b) => b.hits - a.hits));
show('部分覆盖（需接管关键属性）', buckets.partial.sort((a, b) => b.hits - a.hits));
show('完全未被覆盖（必须保留）', buckets.alive.sort((a, b) => b.hits - a.hits));

writeFileSync('docs/gates/full-migration-map.json', JSON.stringify({
  total: ruleStats.size,
  dead: buckets.dead,
  partial: buckets.partial,
  alive: buckets.alive,
}, null, 2));

console.log('\n完整清单 → docs/gates/full-migration-map.json');
await browser.close();
