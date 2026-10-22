// 读 hana 对话消息的完整结构：avatarRow / messageGroup / 气泡
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
    const close = css.indexOf('}', open);
    if (close < 0) break;
    if (sel.includes(key)) out.push({ sel, body: css.slice(open + 1, close) });
    i = close + 1;
  }
  return out;
}

for (const k of ['avatarRow', 'messageGroup', 'messageBody', 'userMessage', 'assistantMessage']) {
  const rs = rules(k);
  console.log(`\n${'='.repeat(76)}\n=== ${k}（${rs.length}）`);
  for (const r of rs.slice(0, 7)) {
    console.log(`\n【${r.sel.slice(0, 105)}】`);
    for (const d of r.body.split(';')) {
      const s = d.trim();
      if (s) console.log(`    ${s.slice(0, 86)}`);
    }
  }
}
