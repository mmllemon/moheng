// 列出卡片与面板族的全部规则
import { readFileSync } from 'node:fs';

const d = JSON.parse(readFileSync('D:/WorkSpace/hana/moheng/docs/gates/full-migration-map-v2.json', 'utf8'));

const TEST = (s) => /\.panel|\.card|\.metric|\.stat|\.tile|\.box|notice-summary/.test(s);

const all = [
  ...d.dead.map((x) => ({ ...x, kind: 'dead' })),
  ...d.partial.map((x) => ({ ...x, kind: 'partial' })),
  ...d.alive.map((x) => ({ ...x, kind: 'alive' })),
].filter((x) => TEST(x.sel));

const cnt = { dead: 0, partial: 0, alive: 0 };
for (const x of all) cnt[x.kind]++;
console.log(`卡片与面板族共 ${all.length} 条：可删 ${cnt.dead} / 需接管 ${cnt.partial} / 须保留 ${cnt.alive}\n`);

for (const kind of ['dead', 'partial', 'alive']) {
  const list = all.filter((x) => x.kind === kind).sort((a, b) => b.hits - a.hits);
  console.log(`\n${'='.repeat(76)}\n${kind.toUpperCase()} — ${list.length} 条\n${'='.repeat(76)}`);
  for (const x of list) {
    console.log(`\n[${x.sheet.replace('.css', '')}] hits=${x.hits} 共${x.declCount}属性`);
    console.log(`  ${x.sel.slice(0, 118)}`);
    if (x.partly?.length) console.log(`  ~部分: ${x.partly.slice(0, 6).join(' ')}`);
    if (x.none?.length) console.log(`  ✗未覆盖: ${x.none.slice(0, 8).join(' ')}`);
  }
}
