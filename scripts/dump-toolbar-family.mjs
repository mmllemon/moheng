// 列出工具栏族的全部规则，按可删/需接管/须保留分组，并输出可删项的完整声明
import { readFileSync } from 'node:fs';

const d = JSON.parse(readFileSync('D:/WorkSpace/hana/moheng/docs/gates/full-migration-map.json', 'utf8'));

const TEST = (s) => /toolbar|filter-bar|page-actions|section-head|page-header/.test(s);

const all = [
  ...d.dead.map((x) => ({ ...x, kind: 'dead' })),
  ...d.partial.map((x) => ({ ...x, kind: 'partial' })),
  ...d.alive.map((x) => ({ ...x, kind: 'alive' })),
].filter((x) => TEST(x.sel));

console.log(`工具栏族共 ${all.length} 条\n`);

for (const kind of ['dead', 'partial', 'alive']) {
  const list = all.filter((x) => x.kind === kind);
  console.log(`\n${'='.repeat(70)}\n${kind.toUpperCase()} — ${list.length} 条\n${'='.repeat(70)}`);
  for (const x of list.sort((a, b) => b.hits - a.hits)) {
    console.log(`\n[${x.sheet.replace('.css', '')}] hits=${x.hits} 共${x.declCount}属性`);
    console.log(`  ${x.sel}`);
    if (x.covered && x.covered.length) console.log(`  ✓已覆盖: ${x.covered.join(' ')}`);
    if (x.uncovered && x.uncovered.length) console.log(`  ✗未覆盖: ${x.uncovered.join(' ')}`);
  }
}
