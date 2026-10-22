// 提取卡片族 dead 规则的原文，并标注是否混合规则
import { readFileSync, writeFileSync } from 'node:fs';

const d = JSON.parse(readFileSync('D:/WorkSpace/hana/moheng/docs/gates/full-migration-map-v2.json', 'utf8'));
const TEST = (s) => /\.panel|\.card|\.metric|\.stat|\.tile|\.box|notice-summary/.test(s);

// 其它族的特征类名：出现即说明是混合规则，不能整条删
const OTHER_FAMILY = /\.section-heading|\.field\b|\.form-|\.data-table|\.toolbar|\.ldg-|\.an-|\.cost-|\.budget-|\.bill-|\.change-s|\.owner-|\.report-|\.system-|\.audit-|\.user-t/;

const dead = d.dead.filter((x) => TEST(x.sel));

const out = [];
for (const t of dead) {
  const parts = t.sel.split(',').map((s) => s.trim());
  // 每个片段是否含卡片族类名 / 是否含其它族类名
  const cardParts = parts.filter((p) => TEST(p));
  const otherParts = parts.filter((p) => !TEST(p));
  out.push({
    sheet: t.sheet,
    sel: t.sel,
    hits: t.hits,
    parts: parts.length,
    cardParts,
    otherParts,
    pure: otherParts.length === 0,
  });
}

const pure = out.filter((x) => x.pure);
const mixed = out.filter((x) => !x.pure);

console.log(`纯卡片选择器（可整条删）: ${pure.length}`);
console.log(`混合规则（需手术）: ${mixed.length}\n`);

console.log('=== 混合规则明细 ===');
for (const m of mixed) {
  console.log(`\n[${m.sheet.replace('.css', '')}] ${m.sel.slice(0, 100)}`);
  console.log(`  卡片部分: ${m.cardParts.join(', ') || '(无)'}`);
  console.log(`  其它部分: ${m.otherParts.join(', ')}`);
}

writeFileSync('D:/WorkSpace/hana/moheng/docs/gates/card-split.json', JSON.stringify({ pure, mixed }, null, 2));
console.log(`\n→ docs/gates/card-split.json`);
