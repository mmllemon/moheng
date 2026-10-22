// 在全部 33 个组件 CSS 里精确找「侧栏内部横线」
import { readdirSync, readFileSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35/assets';
const files = readdirSync(dir).filter((f) => f.endsWith('.css'));

// 侧栏特有的类名片段
const SIDEBAR_HINTS = /sidebar|session|activity|nav-|_sidebar|Sidebar/;

console.log('=== 含侧栏类名 + 横线的规则 ===\n');

for (const f of files) {
  const css = readFileSync(`${dir}/${f}`, 'utf8');
  // 拆成规则
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  const hits = [];
  while ((m = ruleRe.exec(css))) {
    const sel = m[1].trim();
    const body = m[2];
    if (!SIDEBAR_HINTS.test(sel)) continue;
    // 找 border-top / border-bottom / box-shadow inset
    const lines = body.split(';').filter((d) => /border-(top|bottom)/.test(d) || /inset/.test(d));
    if (lines.length) {
      hits.push({ sel: sel.slice(0, 70), lines });
    }
  }
  if (hits.length) {
    console.log(`[${f}]`);
    for (const h of hits.slice(0, 10)) {
      console.log(`  ${h.sel}`);
      for (const l of h.lines) console.log(`      ${l.trim()}`);
    }
    console.log('');
  }
}

// 另外：找所有「只有 border-top 且颜色是 border/overlay」的通用分隔线规则
console.log('\n=== 所有 border-top 分隔线规则（不限侧栏）===\n');
for (const f of files) {
  const css = readFileSync(`${dir}/${f}`, 'utf8');
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  const hits = [];
  while ((m = ruleRe.exec(css))) {
    const sel = m[1].trim();
    const body = m[2];
    const bt = /border-top\s*:\s*([^;]+)/.exec(body);
    if (bt && /var\(--border|var\(--overlay/.test(bt[1])) {
      hits.push({ sel: sel.slice(0, 60), val: bt[1].trim() });
    }
  }
  if (hits.length) {
    console.log(`[${f}] ${hits.length} 条`);
    for (const h of hits.slice(0, 4)) console.log(`    ${h.sel}  →  ${h.val}`);
  }
}
