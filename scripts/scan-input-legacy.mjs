// 扫描 legacy/v6 里属于「输入控件族」的规则，并区分纯规则与混合规则
import { readFileSync } from 'node:fs';

const FILES = [
  { name: 'legacy.css', path: 'D:/WorkSpace/hana/moheng/apps/web/src/styles/legacy.css' },
  { name: 'v6.css', path: 'D:/WorkSpace/hana/moheng/apps/web/src/styles/v6.css' },
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
      bufStart = i + 1; i++; continue;
    }
    if (ch === '}') {
      const t = stack.pop();
      if (t) { out.push({ start: t.selStart, end: i + 1, sel: t.sel, depth: stack.length }); bufStart = i + 1; }
      i++; continue;
    }
    if (ch === ';' && stack.length === 0) { bufStart = i + 1; i++; continue; }
    i++;
  }
  return out;
}

// 输入控件族的判据：选择器里出现原生标签或输入相关类名
const INPUT_TOKENS = [
  'input', 'select', 'textarea',
  '.field', '.form-stack', '.form-grid', '.filter-bar',
  '.search-input', '.toolbar-search', '.select-control', '.date-picker',
  '.checkbox-line', '.radio-line', '.switch', '.toggle',
];

function classify(sel) {
  const bare = sel.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const parts = bare.split(',').map((s) => s.trim()).filter(Boolean);
  const isInputish = (p) => {
    const low = p.toLowerCase();
    // 排除只提到 input[type=checkbox] 但整体是别的东西的情况暂不细究
    return INPUT_TOKENS.some((t) => low.includes(t));
  };
  const hits = parts.filter(isInputish);
  if (!hits.length) return { kind: 'other', bare, parts };
  if (hits.length === parts.length) return { kind: 'pure', bare, parts };
  return { kind: 'mixed', bare, parts, others: parts.filter((p) => !isInputish(p)) };
}

for (const f of FILES) {
  const css = readFileSync(f.path, 'utf8');
  const rules = findRules(css).filter((r) => !/^@(layer|media|supports|keyframes|font-face)/.test(r.sel.trim()));
  const pure = [];
  const mixed = [];
  for (const r of rules) {
    const c = classify(r.sel);
    if (c.kind === 'pure') pure.push({ ...r, c });
    else if (c.kind === 'mixed') mixed.push({ ...r, c });
  }
  console.log(`\n${'='.repeat(70)}\n${f.name}: 纯 ${pure.length} 条 / 混合 ${mixed.length} 条\n${'='.repeat(70)}`);
  if (pure.length) {
    console.log('\n--- 纯规则（候选删除）---');
    for (const r of pure.slice(0, 40)) console.log(`  d=${r.depth} ${r.c.bare.slice(0, 88)}`);
    if (pure.length > 40) console.log(`  ... 还有 ${pure.length - 40} 条`);
  }
  if (mixed.length) {
    console.log('\n--- 混合规则（跳过）---');
    for (const r of mixed.slice(0, 20)) {
      const others = [...new Set(r.c.others.map((p) => p.split(/\s|>/)[0]))].slice(0, 4);
      console.log(`  ${r.c.bare.slice(0, 76)}`);
      console.log(`      含其它: ${others.join(' ')}`);
    }
    if (mixed.length > 20) console.log(`  ... 还有 ${mixed.length - 20} 条`);
  }
}
