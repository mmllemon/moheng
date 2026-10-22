// 检验所有已迁移脚本是否能正常加载（语法检查）+ 抓出明显问题
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const dir = 'D:/WorkSpace/hana/moheng/scripts';
const files = readdirSync(dir).filter((f) => f.endsWith('.mjs') && !f.startsWith('_'));

const migrated = [];
const skipped = [];

for (const f of files) {
  const text = readFileSync(`${dir}/${f}`, 'utf8');
  if (!text.includes('chromium.launch')) continue;
  if (text.includes("from './_harness.mjs'") || text.includes("_harness.mjs'")) migrated.push(f);
  else skipped.push(f);
}

console.log(`已接入 harness: ${migrated.length}`);
console.log(`未接入: ${skipped.length}${skipped.length ? ' → ' + skipped.join(', ') : ''}\n`);

// 语法检查：node --check 对 ESM 需要 .mjs，直接用 --check
let bad = 0;
for (const f of migrated) {
  try {
    execFileSync(process.execPath, ['--check', `${dir}/${f}`], { stdio: 'pipe' });
  } catch (e) {
    bad++;
    console.log(`✗ 语法错误: ${f}`);
    console.log('  ' + (e.stderr?.toString() || e.message).split('\n').slice(0, 4).join('\n  '));
  }
}
console.log(bad === 0 ? '✓ 全部语法正确' : `✗ ${bad} 个文件有语法错误`);

// 检查引用了哪些 harness 导出，确认都存在
const harness = readFileSync(`${dir}/_harness.mjs`, 'utf8');
const exported = new Set([...harness.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map((m) => m[1]));
console.log(`\nharness 导出: ${[...exported].join(', ')}`);

const missing = new Set();
for (const f of migrated) {
  const text = readFileSync(`${dir}/${f}`, 'utf8');
  const m = text.match(/import\s+\{([^}]*)\}\s+from\s+['"]\.\/_harness\.mjs['"]/);
  if (!m) { console.log(`  ⚠ ${f}: 有 _harness 引用但无法解析 import`); continue; }
  for (const n of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!exported.has(n)) { missing.add(`${f}: ${n}`); }
  }
}
if (missing.size) { console.log('\n✗ 引用了不存在的导出:'); for (const m of missing) console.log('  ' + m); }
else console.log('✓ 所有 import 的符号都存在');
