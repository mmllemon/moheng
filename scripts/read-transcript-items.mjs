// 按选择器名精确切片读规则（CSS 是压缩单行，需要手写解析）
import { readFileSync } from 'node:fs';

const file = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35/assets/ChatTranscript-DhOABhoU.css';
const css = readFileSync(file, 'utf8');

function rules(key) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const sel = css.slice(i, open).trim();
    // 处理 @media / @supports 嵌套：跳过 at-rule 的前导
    const close = css.indexOf('}', open);
    if (close < 0) break;
    const body = css.slice(open + 1, close);
    if (sel.includes(key)) out.push({ sel, body });
    i = close + 1;
  }
  return out;
}

for (const key of ['virtualTranscriptItemInner', 'sessionMessages', 'virtualTranscriptItem']) {
  const rs = rules(key);
  console.log(`\n${'='.repeat(76)}\n=== ${key}（${rs.length} 条）`);
  for (const r of rs) {
    console.log(`\n【${r.sel.slice(0, 100)}】`);
    for (const d of r.body.split(';')) {
      const s = d.trim();
      if (!s) continue;
      console.log(`    ${s.slice(0, 88)}`);
    }
  }
}
