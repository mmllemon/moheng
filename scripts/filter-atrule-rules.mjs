// 从待删清单里剔除位于 @media / @supports 内的规则（缩进 2 格以上）
import { readFileSync, writeFileSync } from 'node:fs';

const split = JSON.parse(readFileSync('D:/WorkSpace/hana/moheng/docs/gates/card-split.json', 'utf8'));

const safe = [];
const inAtRule = [];

for (const t of split.pure) {
  const lines = readFileSync(`D:/WorkSpace/hana/moheng/apps/web/src/styles/${t.sheet}`, 'utf8').split('\n');
  const want = t.sel.replace(/\s+/g, ' ').trim();
  let found = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('{')) continue;
    const sel = lines[i].slice(0, lines[i].indexOf('{')).replace(/\s+/g, ' ').trim();
    if (sel === want) { found = i; break; }
  }
  if (found < 0) {
    // 混合规则的原文可能带空格差异，用宽松匹配再试一次
    const loose = want.replace(/\s*,\s*/g, ',');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes('{')) continue;
      const sel = lines[i].slice(0, lines[i].indexOf('{')).replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').trim();
      if (sel === loose) { found = i; break; }
    }
  }
  if (found < 0) { inAtRule.push({ ...t, reason: '未定位（需人工看）' }); continue; }
  // 缩进即可判断：@media/@supports 内的规则行首会有空格
  const indented = /^\s+/.test(lines[found]);
  if (indented) inAtRule.push({ ...t, reason: '在 @media/@supports 内', line: found + 1 });
  else safe.push({ ...t, line: found + 1 });
}

console.log(`可安全整条删: ${safe.length}`);
console.log(`剔除（在断点内）: ${inAtRule.length}\n`);
for (const x of inAtRule) {
  console.log(`  [${x.sheet.replace('.css', '')}:${x.line ?? '?'}] ${x.sel.slice(0, 80)}`);
  console.log(`      ${x.reason}`);
}

writeFileSync('D:/WorkSpace/hana/moheng/docs/gates/card-safe.json', JSON.stringify(safe, null, 2));
console.log(`\n安全清单 → docs/gates/card-safe.json`);
