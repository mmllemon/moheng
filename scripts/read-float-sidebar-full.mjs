// 读 hana 浮出侧栏（float panel）的完整规则：_fp_ / _fpCollapsed_ / _fpOverlay_ / _fpShadowless_
import { readFileSync, readdirSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35/assets';

function rules(css, key) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const sel = css.slice(i, open).trim();
    const close = css.indexOf('}', open);
    if (close < 0) break;
    if (sel.includes(key)) out.push({ sel, body: css.slice(open + 1, close) });
    i = close + 1;
  }
  return out;
}

const keys = ['_fp_', '_fpCollapsed_', '_fpOverlay_', '_fpShadowless_', '_fpResizeHandle_', '_fpSidebarHost_'];

for (const f of readdirSync(dir).filter((x) => x.endsWith('.css'))) {
  const css = readFileSync(`${dir}/${f}`, 'utf8');
  for (const k of keys) {
    const rs = rules(css, k);
    if (!rs.length) continue;
    console.log(`\n${'='.repeat(84)}\n### ${f} ← ${k}（${rs.length}）`);
    for (const r of rs) {
      console.log(`\n【${r.sel.slice(0, 118)}】`);
      for (const d of r.body.split(';')) {
        const s = d.trim();
        if (s) console.log(`    ${s.slice(0, 100)}`);
      }
    }
  }
}
