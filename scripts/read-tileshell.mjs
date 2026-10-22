// 完整读 _tileShell / _tileBare —— 会话大卡片的圆角、背景、边框、内边距
import { readFileSync, readdirSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35/assets';

function dump(file, key, limit = 99) {
  const css = readFileSync(`${dir}/${file}`, 'utf8');
  const re = new RegExp(`[^{}]*_${key}_[a-f0-9]{5}[^{]*\\{[^}]*\\}`, 'g');
  const ms = css.match(re) ?? [];
  if (!ms.length) return;
  console.log(`\n${'='.repeat(78)}\n### ${file} ← ${key}（${ms.length} 条）`);
  for (const m of ms.slice(0, limit)) {
    const i = m.indexOf('{');
    const sel = m.slice(0, i).trim();
    console.log(`\n【${sel.length > 110 ? sel.slice(0, 110) + '…' : sel}】`);
    for (const d of m.slice(i + 1, -1).split(';')) {
      const s = d.trim();
      if (!s) continue;
      const j = s.indexOf(':');
      console.log(`    ${(j < 0 ? s : s.slice(0, j).trim().padEnd(30) + s.slice(j + 1).trim().slice(0, 60))}`);
    }
  }
}

for (const f of readdirSync(dir).filter((x) => x.endsWith('.css'))) {
  for (const k of ['tileShell', 'tileContent']) dump(f, k, 40);
}
