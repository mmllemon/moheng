// 检查 .button-primary / .button-secondary 等语义类在各处的字号定义
import { readFileSync } from 'node:fs';

const FILES = [
  'apps/web/src/styles/hana.css',
  'apps/web/src/styles/v6.css',
  'apps/web/src/styles/legacy.css',
  'apps/web/src/styles/stat-metrics.css',
  'apps/web/src/styles/content-contrast.css',
];

function parse(css) {
  const s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const stack = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') { stack.push(buf.trim()); buf = ''; }
    else if (ch === '}') {
      const body = buf.trim();
      const sel = stack.pop() || '';
      buf = '';
      if (body && sel && !sel.startsWith('@')) out.push({ sel: sel.replace(/\s+/g, ' '), body });
    } else buf += ch;
  }
  return out;
}

const TARGETS = ['button-primary', 'button-secondary', 'button-danger', 'button-ghost', 'button-small'];

for (const target of TARGETS) {
  console.log(`\n${'='.repeat(70)}\n.${target}\n${'='.repeat(70)}`);
  for (const f of FILES) {
    let css;
    try { css = readFileSync('D:/WorkSpace/hana/moheng/' + f, 'utf8'); }
    catch { continue; }
    const hits = parse(css).filter(
      (r) => r.sel.includes(target) && /font-size\s*:/.test(r.body)
    );
    if (!hits.length) continue;
    console.log(`\n  [${f.split('/').pop()}]`);
    for (const h of hits) {
      const fs = h.body.match(/font-size\s*:\s*([^;]+)/);
      const fw = h.body.match(/font-weight\s*:\s*([^;]+)/);
      console.log(`    ${h.sel.slice(0, 78)}`);
      console.log(`        fs=${fs ? fs[1].trim() : '-'}  fw=${fw ? fw[1].trim() : '-'}`);
    }
  }
}
