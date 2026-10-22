// 迁移进度盘点（修正版）：区分「可安全删 / 断点内 / 未定位 / 已登记不该删」
import { readFileSync } from 'node:fs';

const d = JSON.parse(readFileSync('D:/WorkSpace/hana/moheng/docs/gates/full-migration-map-v2.json', 'utf8'));

const FAMILIES = [
  { name: '排版与文本', test: (s) => /^(h1|h2|h3|h4|h5|h6|p|a|small|strong|em|code|pre)\b|^body|^html|^\*/.test(s.trim()) },
  { name: '导航与侧栏', test: (s) => /sidebar|\.nav-|nav-link|breadcrumb|titlebar|topbar|\.tab\b|\.tabs\b|main-shell|app-header|app-footer/.test(s) },
  { name: '工具栏', test: (s) => /toolbar|filter-bar|page-actions|section-head|page-header/.test(s) },
  { name: '卡片与面板', test: (s) => /\.panel|\.card|\.metric|\.stat|\.tile|\.box|notice-summary/.test(s) },
  { name: '表格', test: (s) => /\btable\b|tbody|thead|\.data-table|\.ldg-table|^th\b|^td\b|\.table-/.test(s) },
  { name: '表单控件', test: (s) => /\binput\b|\bselect\b|\btextarea\b|\.field\b|\.form-|checkbox-line|select-control|date-picker/.test(s) },
];

// 已登记为「不该删」的选择器（docs/未迁移项登记.md）
const PROTECTED = new Set([
  '.select-control-chevron',
  '.date-picker-proxy',
  '.date-picker-value',
  '.date-picker-icon',
  '.status-badge',
]);

const done = { 排版与文本: 6, 工具栏: 18, 卡片与面板: 41, 表格: 18, 表单控件: 10, 导航与侧栏: 0 };

const rows = [];
for (const f of FAMILIES) {
  const all = [
    ...d.dead.map((x) => ({ ...x, kind: 'dead' })),
    ...d.partial.map((x) => ({ ...x, kind: 'partial' })),
    ...d.alive.map((x) => ({ ...x, kind: 'alive' })),
  ].filter((x) => f.test(x.sel));

  let safe = 0, inMedia = 0, unfound = 0, prot = 0;
  for (const t of all) {
    if (t.kind !== 'dead') continue;
    if (PROTECTED.has(t.sel)) { prot++; continue; }
    const lines = readFileSync(`D:/WorkSpace/hana/moheng/apps/web/src/styles/${t.sheet}`, 'utf8').split('\n');
    const want = t.sel.replace(/\s+/g, ' ').trim();
    let found = -1;
    const tryMatch = (loose) => {
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes('{')) continue;
        let sel = lines[i].slice(0, lines[i].indexOf('{')).replace(/\s+/g, ' ').trim();
        if (loose) sel = sel.replace(/\s*,\s*/g, ',');
        const target = loose ? want.replace(/\s*,\s*/g, ',') : want;
        if (sel === target) return i;
      }
      return -1;
    };
    found = tryMatch(false);
    if (found < 0) found = tryMatch(true);
    if (found < 0) { unfound++; continue; }
    if (/^\s+/.test(lines[found])) inMedia++; else safe++;
  }
  rows.push({ name: f.name, done: done[f.name] || 0, safe, inMedia, unfound, prot });
}

console.log('族'.padEnd(14) + '已删'.padStart(6) + '可安全删'.padStart(10) + '断点内'.padStart(8) + '未定位'.padStart(8) + '已保护'.padStart(8));
console.log('-'.repeat(58));
let sd = 0, ss = 0, sm = 0, su = 0, sp = 0;
for (const r of rows) {
  console.log(r.name.padEnd(14) + String(r.done).padStart(6) + String(r.safe).padStart(10) + String(r.inMedia).padStart(8) + String(r.unfound).padStart(8) + String(r.prot).padStart(8));
  sd += r.done; ss += r.safe; sm += r.inMedia; su += r.unfound; sp += r.prot;
}
console.log('-'.repeat(58));
console.log('合计'.padEnd(14) + String(sd).padStart(6) + String(ss).padStart(10) + String(sm).padStart(8) + String(su).padStart(8) + String(sp).padStart(8));

console.log(`\n「未定位」= 地图里还在、但源码里找不到 → 说明已删除（本轮成果）。`);
console.log(`「断点内」= 在 @media 里，需四视口验证，可继续做。`);
console.log(`「已保护」= 登记为不该删（见 docs/未迁移项登记.md）。`);
console.log(`\n真正剩余可删：${ss} 条（顶层，桌面快照可验证）+ ${sm} 条（断点内，需四视口）`);
