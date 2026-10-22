// 迁移试点判据：对每个选择器，实测它声明的属性里哪些是「实际生效」的
// 原理：用 CDP 的 CSS.getMatchedStylesForNode 拿到层叠后每个属性的胜出规则
import { chromium } from 'playwright-core';

import { login } from './_harness.mjs';
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

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

const cdp = await ctx.newCDPSession(page);
await cdp.send('DOM.enable');
await cdp.send('CSS.enable');

// 记录：每个「来源文件+选择器+属性」是否曾作为胜出者出现
const winning = new Map(); // key -> { file, sel, prop, count }
const touched = new Map(); // key -> 元素出现次数

function key(file, sel, prop) { return `${file}\\u0000${sel}\\u0000${prop}`; }

async function analyzeElement(handle) {
  const { objectId } = handle;
  let matched;
  try {
    const remote = { objectId };
    const { nodeId } = await cdp.send('DOM.requestNode', { objectId });
    matched = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
  } catch {
    return;
  }

  // 收集该元素的全部声明，按 layer/specificity 顺序已由 CDP 排序（matchedCSSRules 按优先级从低到高）
  const all = [];
  const push = (rule, kind) => {
    if (!rule.selectorList) return;
    const file = (rule.styleSheetId ? rule.styleSheetId : 'inline');
    for (const sel of rule.selectorList.selectors || [rule.selectorList.text]) {
      for (const prop of rule.style.cssProperties || []) {
        if (prop.disabled || !prop.name || prop.value === undefined) continue;
        all.push({ file, sel: rule.origin === 'regular' ? sel.text : `${kind}:${sel.text}`, prop: prop.name.toLowerCase(), important: !!prop.important });
      }
      void sel;
    }
  };
  for (const m of matched.matchedCSSRules || []) push(m.rule, 'matched');
  for (const m of matched.inherited || []) {
    for (const r of m.matchedCSSRules || []) push(r.rule, 'inherited');
  }

  // 同一属性，最后出现的就是胜出者（CDP 已按优先级排序）
  const winner = new Map();
  for (const d of all) {
    const prev = winner.get(d.prop);
    if (!prev) { winner.set(d.prop, d); continue; }
    if (d.important && !prev.important) winner.set(d.prop, d);
    else if (!d.important && prev.important) continue;
    else winner.set(d.prop, d);
  }

  for (const [prop, d] of winner) {
    const k = key(d.file, d.sel, prop);
    if (!winning.has(k)) winning.set(k, { file: d.file, sel: d.sel, prop, count: 0 });
    winning.get(k).count++;
  }
  for (const d of all) {
    const k = key(d.file, d.sel, d.prop);
    if (!touched.has(k)) touched.set(k, { file: d.file, sel: d.sel, prop: d.prop, count: 0 });
    touched.get(k).count++;
  }
}

for (const route of ROUTES) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(860);

  const handles = await page.evaluateHandle(() =>
    [...document.querySelectorAll('.button, .button-primary, .button-secondary, .button-ghost, .button-danger, .button-small')]
      .filter((e) => getComputedStyle(e).display !== 'none')
  );
  const props = await handles.getProperties();
  for (const [, h] of props) {
    const el = h.asElement();
    if (!el) continue;
    await analyzeElement(el);
  }
  await handles.dispose();
}

// 汇总：按「选择器」分组，看它声明的属性里有多少是胜出、多少被覆盖
const bySelector = new Map();
for (const [k, v] of touched) {
  const id = `${v.sel}`;
  if (!bySelector.has(id)) bySelector.set(id, { sel: v.sel, total: 0, win: 0, props: [] });
  const g = bySelector.get(id);
  g.total++;
  const w = winning.get(k);
  if (w && w.count > 0) { g.win++; g.props.push(`${v.prop}(胜${w.count})`); }
}

const rows = [...bySelector.values()].sort((a, b) => b.total - a.total);

console.log('=== 选择器级：属性声明总数 vs 实际胜出数 ===\n');
console.log('说明：win=0 表示该选择器声明的属性全被更后面的规则覆盖，等同死代码。\n');
for (const r of rows.slice(0, 70)) {
  const verdict = r.win === 0 ? '死' : r.win === r.total ? '全生效' : '部分生效';
  console.log(`${String(r.total).padStart(3)}声明 / ${String(r.win).padStart(3)}胜出  [${verdict}]  ${r.sel.slice(0, 88)}`);
  if (r.win > 0 && r.win <= 8) console.log(`      ${r.props.join(' ')}`);
}

// 统计
const dead = rows.filter((r) => r.win === 0);
const partial = rows.filter((r) => r.win > 0 && r.win < r.total);
console.log(`\n合计 ${rows.length} 个选择器：完全失效 ${dead.length}、部分生效 ${partial.length}、全部生效 ${rows.filter((r) => r.win === r.total).length}`);

await browser.close();
