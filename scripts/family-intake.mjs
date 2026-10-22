// 族入场体检：统计该族的规则分布、断点占比、混合规则占比
// 用法: node family-intake.mjs 排版与文本
import { readFileSync } from 'node:fs';

// 族判定顺序很重要：先匹配更具体的族，后匹配宽泛的
const FAMILIES = {
  // 表格：优先于导航（.table-action / .table-primary-text 属表格）
  表格: (s) => /\btable\b|tbody|thead|\.data-table|\.ldg-table|^th\b|^td\b|\.table-/.test(s),
  // 导航：只认真正的导航结构，不认 .cost-workspace-nav-* 这种业务子导航除非没别处去
  导航与侧栏: (s) => /sidebar|\.nav-|nav-link|breadcrumb|titlebar|topbar|\.tab\b|\.tabs\b|main-shell|app-header|app-footer/.test(s),
  表单控件: (s) => /\binput\b|\bselect\b|\btextarea\b|\.field\b|\.form-|checkbox-line|select-control|date-picker/.test(s),
  工具栏: (s) => /toolbar|filter-bar|page-actions|section-head|page-header/.test(s),
  卡片与面板: (s) => /\.panel|\.card|\.metric|\.stat|\.tile|\.box|notice-summary/.test(s),
  排版与文本: (s) => /^(h1|h2|h3|h4|h5|h6|p|a|small|strong|em|code|pre)\b|^body|^html|^\*/.test(s.trim()),
};

const name = process.argv[2];
if (!name || !FAMILIES[name]) {
  console.log('用法: node family-intake.mjs <族名>');
  console.log('可用:', Object.keys(FAMILIES).join(', '));
  process.exit(1);
}
const TEST = FAMILIES[name];

const d = JSON.parse(readFileSync('D:/WorkSpace/hana/moheng/docs/gates/full-migration-map-v2.json', 'utf8'));
const all = [
  ...d.dead.map((x) => ({ ...x, kind: 'dead' })),
  ...d.partial.map((x) => ({ ...x, kind: 'partial' })),
  ...d.alive.map((x) => ({ ...x, kind: 'alive' })),
].filter((x) => TEST(x.sel));

console.log(`\n=== ${name} 族入场体检 ===\n`);
console.log(`总数 ${all.length}：可删 ${all.filter((x) => x.kind === 'dead').length} / 需接管 ${all.filter((x) => x.kind === 'partial').length} / 须保留 ${all.filter((x) => x.kind === 'alive').length}\n`);

// 按 sheet 和是否在断点内分组
const rows = [];
for (const t of all) {
  const lines = readFileSync(`D:/WorkSpace/hana/moheng/apps/web/src/styles/${t.sheet}`, 'utf8').split('\n');
  const want = t.sel.replace(/\s+/g, ' ').trim();
  let found = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('{')) continue;
    const sel = lines[i].slice(0, lines[i].indexOf('{')).replace(/\s+/g, ' ').trim();
    if (sel === want) { found = i; break; }
  }
  if (found < 0) {
    const loose = want.replace(/\s*,\s*/g, ',');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes('{')) continue;
      const sel = lines[i].slice(0, lines[i].indexOf('{')).replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').trim();
      if (sel === loose) { found = i; break; }
    }
  }
  const inAtRule = found >= 0 && /^\s+/.test(lines[found]);
  const mixed = t.sel.split(',').length > 1;
  rows.push({ ...t, inAtRule, mixed, located: found >= 0, line: found + 1 });
}

const dead = rows.filter((r) => r.kind === 'dead');
const deadTop = dead.filter((r) => r.located && !r.inAtRule);
const deadMedia = dead.filter((r) => r.inAtRule);
const deadUnknown = dead.filter((r) => !r.located);

console.log(`可删的 ${dead.length} 条分布：`);
console.log(`  顶层（桌面快照可见）: ${deadTop.length}`);
console.log(`  断点内（需多视口验证）: ${deadMedia.length}`);
console.log(`  未定位（需人工看）: ${deadUnknown.length}`);

const mixTop = deadTop.filter((r) => r.mixed);
console.log(`\n顶层里混合规则 ${mixTop.length} 条（需选择器手术）`);

console.log(`\n${'─'.repeat(70)}`);
console.log('顶层可删清单:');
for (const r of deadTop) {
  const flag = r.mixed ? '[混合]' : '      ';
  console.log(`  ${flag} [${r.sheet.replace('.css', '')}:${r.line}] ${r.sel.slice(0, 80)}`);
}
if (deadMedia.length) {
  console.log(`\n断点内（本轮跳过，不删）:`);
  for (const r of deadMedia) console.log(`    [${r.sheet.replace('.css', '')}:${r.line}] ${r.sel.slice(0, 76)}`);
}
if (deadUnknown.length) {
  console.log(`\n未定位:`);
  for (const r of deadUnknown) console.log(`    [${r.sheet.replace('.css', '')}] ${r.sel.slice(0, 76)}`);
}

console.log(`\n\n结论：` + (deadMedia.length > 0
  ? `必须跑四视口验证（${deadMedia.length} 条在断点内）`
  : `桌面快照即可覆盖（无断点内规则）`));
