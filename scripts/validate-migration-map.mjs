// 验证全量分类工具是否准确：用它已知的答案对照
import { readFileSync } from 'node:fs';

const d = JSON.parse(readFileSync('D:/WorkSpace/hana/moheng/docs/gates/full-migration-map.json', 'utf8'));

const norm = (s) => s.replace(/\s+/g, '').replace(/["']/g, '');
const find = (sel) => {
  const target = norm(sel);
  const out = {};
  for (const k of ['dead', 'partial', 'alive']) {
    const f = d[k].find((x) => norm(x.sel) === target);
    if (f) out[k] = f;
  }
  return out;
};

console.log('=== 校准 1：.button 家族（已知：已全部被 hana 覆盖，我已删 48 条）===');
const buttonSels = ['.button', '.button-primary', '.button-secondary', '.button-ghost', '.button-danger', '.button-small'];
let btnHit = 0;
for (const s of buttonSels) {
  const r = find(s);
  const kind = Object.keys(r)[0] || '未找到';
  if (kind === 'dead') btnHit++;
  console.log(`  ${s.padEnd(20)} → ${kind}${r.partial ? '  未覆盖: ' + r.partial.uncovered.join(' ') : ''}`);
}
console.log(`  判定为 dead 的: ${btnHit}/${buttonSels.length}`);

console.log('\n=== 校准 2：输入控件（已知：皮肤依赖 v6，不可删）===');
// 找所有含 input 的规则
const inputRules = [...d.dead, ...d.partial, ...d.alive].filter((x) => /^input|input,|input:not/.test(x.sel.replace(/\s+/g, ' ').trim()));
for (const x of inputRules.slice(0, 8)) {
  const kind = d.dead.includes(x) ? 'dead' : d.partial.includes(x) ? 'partial' : 'alive';
  console.log(`  [${kind.padEnd(7)}] ${x.sel.slice(0, 66)}`);
  if (x.uncovered && x.uncovered.length) console.log(`            未覆盖: ${x.uncovered.slice(0, 8).join(' ')}`);
}

console.log('\n=== 汇总 ===');
console.log(`  dead ${d.dead.length} / partial ${d.partial.length} / alive ${d.alive.length}  合计 ${d.total}`);
