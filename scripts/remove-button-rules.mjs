// 从 legacy.css / v6.css 中删除 .button 规则
// 安全约束：
//   1. 只删「纯 .button 家族」规则；复合规则（同时含 .icon-button 等其它组件）跳过，改为人工处理
//   2. 选择器文本里若含注释，把注释放回原位
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const TARGETS = [
  'D:/WorkSpace/hana/moheng/apps/web/src/styles/legacy.css',
  'D:/WorkSpace/hana/moheng/apps/web/src/styles/v6.css',
];

function findRules(css) {
  const out = [];
  let i = 0;
  const stack = [];
  let bufStart = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '{') {
      stack.push({ selStart: bufStart, sel: css.slice(bufStart, i).trim() });
      bufStart = i + 1;
      i++;
      continue;
    }
    if (ch === '}') {
      const t = stack.pop();
      if (t) {
        out.push({ start: t.selStart, end: i + 1, sel: t.sel, depth: stack.length });
        bufStart = i + 1;
      }
      i++;
      continue;
    }
    if (ch === ';' && stack.length === 0) { bufStart = i + 1; i++; continue; }
    i++;
  }
  return out;
}

// 判定规则属于哪个组件族
function classify(sel) {
  // 去掉注释后的纯选择器
  const bare = sel.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const parts = bare.split(',').map((s) => s.trim()).filter(Boolean);
  const hasButton = parts.some((p) => /\.button/.test(p));
  if (!hasButton) return { kind: 'other', bare, parts };

  // 只有全部选择器都含 .button 时才算纯 button 规则
  const allButton = parts.every((p) => /\.button/.test(p));
  return { kind: allButton ? 'pure' : 'mixed', bare, parts };
}

let grandTotal = { pure: 0, mixed: 0, skipped: [] };

for (const path of TARGETS) {
  const name = path.split('/').pop();
  const css = readFileSync(path, 'utf8');
  const rules = findRules(css);

  const candidates = rules.filter((r) => {
    if (/^@(layer|media|supports|keyframes|font-face)/.test(r.sel.trim())) return false;
    const c = classify(r.sel);
    return c.kind === 'pure' || c.kind === 'mixed';
  });

  const pure = candidates.filter((r) => classify(r.sel).kind === 'pure');
  const mixed = candidates.filter((r) => classify(r.sel).kind === 'mixed');

  console.log(`\n${name}`);
  console.log(`  纯 button 规则（将删）: ${pure.length}`);
  console.log(`  混合规则（跳过）:      ${mixed.length}`);
  for (const m of mixed) {
    const c = classify(m.sel);
    const others = c.parts.filter((p) => !/\.button/.test(p)).map((p) => p.split(/\s|>/)[0]).slice(0, 3);
    console.log(`    跳过: ${c.bare.slice(0, 66)}`);
    console.log(`          含其它组件: ${[...new Set(others)].join(' ')}`);
    grandTotal.skipped.push({ file: name, sel: c.bare.slice(0, 100), others: [...new Set(others)] });
  }

  // 删除 pure，同时保留注释
  const sorted = [...pure].sort((a, b) => b.start - a.start);
  let out = css;
  for (const r of sorted) {
    const original = css.slice(r.start, r.end);
    const comments = (original.match(/\/\*[\s\S]*?\*\//g) || []).join('\n');
    // 找到规则前的空白起点，一起删
    let s = r.start;
    while (s > 0 && (out[s - 1] === ' ' || out[s - 1] === '\n' || out[s - 1] === '\t')) s--;
    // 用注释替换（注释保留）
    const keep = comments ? '\n' + comments + '\n' : '';
    out = out.slice(0, s) + keep + out.slice(r.end);
  }

  out = out.replace(/\n{3,}/g, '\n\n');

  copyFileSync(path, path + '.bak');
  writeFileSync(path, out, 'utf8');
  console.log(`  ${(css.length / 1024).toFixed(1)} KB → ${(out.length / 1024).toFixed(1)} KB`);
  grandTotal.pure += pure.length;
  grandTotal.mixed += mixed.length;
}

console.log(`\n=== 合计 ===`);
console.log(`  已删除纯 button 规则: ${grandTotal.pure}`);
console.log(`  跳过混合规则:         ${grandTotal.mixed}`);
console.log(`  备份: *.bak`);
