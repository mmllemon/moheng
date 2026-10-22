// 读 _fpOverlayInner_ 与 _fpSidebarHost_ 的规则，以及 fp 在 JSX 里如何被使用
import { readFileSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35/assets';
const css = readFileSync(`${dir}/ChatTranscript-DhOABhoU.css`, 'utf8');

function rules(key) {
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

for (const k of ['_fpOverlayInner_', '_fpSidebarHost_', '_slideEnterFromRight_', '_slideEnterFromLeft_', '_slideLeaveToLeft_', '_slideLeaveToRight_']) {
  const rs = rules(k);
  if (!rs.length) { console.log(`\n=== ${k} 无匹配 ===`); continue; }
  console.log(`\n${'='.repeat(80)}\n=== ${k}（${rs.length}）`);
  for (const r of rs) {
    console.log(`\n【${r.sel.slice(0, 110)}】`);
    for (const d of r.body.split(';')) {
      const s = d.trim();
      if (s) console.log(`    ${s.slice(0, 96)}`);
    }
  }
}
