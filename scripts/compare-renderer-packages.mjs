// 三方对比：seed 包 / 运行时激活 / moheng 参考包
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const ROOTS = {
  seed: 'D:/WorkSpace/hana/hana-seed/renderer',
  runtime: 'C:/Users/leema/.hanako/artifacts/renderer/1.1.35-beta-win32-x64-078ca969122e698c-gb3eb2688cf11fdd0',
  moheng: 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35',
};

function walk(dir, acc = new Map(), base = dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc, base);
    else {
      const rel = relative(base, full).replace(/\\/g, '/');
      const sha = createHash('sha256').update(readFileSync(full)).digest('hex');
      acc.set(rel, { sha, size: st.size });
    }
  }
  return acc;
}

const maps = {};
for (const [k, v] of Object.entries(ROOTS)) {
  try { maps[k] = walk(v); } catch (e) { maps[k] = new Map(); console.log('skip', k, e.message); }
}

for (const k of Object.keys(maps)) console.log(`${k}: ${maps[k].size} files`);

// seed vs runtime
function compare(a, b) {
  const A = maps[a], B = maps[b];
  const onlyA = [...A.keys()].filter((k) => !B.has(k));
  const onlyB = [...B.keys()].filter((k) => !A.has(k));
  const diff = [...A.keys()].filter((k) => B.has(k) && B.get(k).sha !== A.get(k).sha);
  return { onlyA, onlyB, diff, same: [...A.keys()].filter((k) => B.has(k) && B.get(k).sha === A.get(k).sha).length };
}

const sr = compare('seed', 'runtime');
console.log('\n=== seed vs runtime ===');
console.log('identical:', sr.same, '| only-seed:', sr.onlyA.length, '| only-runtime:', sr.onlyB.length, '| differ:', sr.diff.length);
if (sr.onlyA.length) console.log('only-seed:', sr.onlyA.slice(0, 10));
if (sr.onlyB.length) console.log('only-runtime:', sr.onlyB.slice(0, 10));
if (sr.diff.length) console.log('differ:', sr.diff.slice(0, 15));

// moheng 参考包 vs seed
const ms = compare('moheng', 'seed');
console.log('\n=== moheng 参考包 vs seed ===');
console.log('identical:', ms.same, '| only-moheng:', ms.onlyA.length, '| only-seed:', ms.onlyB.length, '| differ:', ms.diff.length);
console.log('\n--- moheng 有的（seed 无）---');
console.log(ms.onlyA.sort().join('\n'));
console.log('\n--- seed 有但 moheng 缺的（前 40）---');
console.log(ms.onlyB.sort().slice(0, 40).join('\n'));
console.log(`\n(moheng 缺 ${ms.onlyB.length} 个文件)`);

// 重点：明文 CSS 的差异
const keyFiles = ['styles.css', 'themes/warm-paper.css', 'themes/midnight-contrast.css',
  'themes/high-contrast.css', 'themes/content-contrast.css', 'themes/continuous-corners.css',
  'animations.css', 'assets/card-style/hana-card-style.css'];
console.log('\n=== 关键 CSS 哈希 ===');
for (const f of keyFiles) {
  const s = maps.seed.get(f);
  const r = maps.runtime.get(f);
  const m = maps.moheng.get(f) ?? maps.moheng.get(f.replace('themes/', 'themes/'));
  console.log(`${f.padEnd(44)} seed=${s?.sha.slice(0, 8) ?? '-'} runtime=${r?.sha.slice(0, 8) ?? '-'} moheng=${m?.sha.slice(0, 8) ?? '-'} ${s && r && s.sha === r.sha ? 'seed=runtime ✓' : 'seed≠runtime ✗'}`);
}

writeFileSync('D:/WorkSpace/hana/moheng/docs/gates/renderer-compare.json', JSON.stringify({
  counts: Object.fromEntries(Object.entries(maps).map(([k, v]) => [k, v.size])),
  seedVsRuntime: { same: sr.same, onlySeed: sr.onlyA, onlyRuntime: sr.onlyB, differ: sr.diff },
  mohengVsSeed: { same: ms.same, onlyMoheng: ms.onlyA, onlySeed: ms.onlyB, differ: ms.diff },
}, null, 2), 'utf8');
console.log('\nwrote docs/gates/renderer-compare.json');
