// 读消息结构的关键规则：avatarName / messageUser / userText / messageAssistant / message
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

for (const k of ['avatarName', 'messageUser', 'userText', 'messageAssistant', 'messageHasWideBlock', 'hanaAvatar', 'userAvatar']) {
  const rs = rules(k);
  if (!rs.length) { console.log(`\n=== ${k} 无匹配 ===`); continue; }
  console.log(`\n${'='.repeat(78)}\n=== ${k}（${rs.length} 条）`);
  for (const r of rs.slice(0, 6)) {
    console.log(`\n【${r.sel.slice(0, 106)}】`);
    for (const d of r.body.split(';')) {
      const s = d.trim();
      if (s) console.log(`    ${s.slice(0, 88)}`);
    }
  }
}
