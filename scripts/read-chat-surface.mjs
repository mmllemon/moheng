// 读 hana 会话表面（卡片）的完整几何：root / parallelChatSurface / tileBare
import { readFileSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35/assets';
const css = readFileSync(`${dir}/ChatTranscript-DhOABhoU.css`, 'utf8');

const targets = ['_root_', '_parallelChatSurface_', '_tileBare_', '_welcomeCardSurface_', '_chalkboardRestoreShell_'];

for (const t of targets) {
  console.log(`\n${'='.repeat(70)}\n=== ${t} ===`);
  const re = new RegExp(`[^{}]*${t}[a-f0-9]{5}[^{]*\\{[^}]*\\}`, 'g');
  const ms = css.match(re) ?? [];
  for (const m of ms) {
    const i = m.indexOf('{');
    const sel = m.slice(0, i).trim();
    const body = m.slice(i + 1, -1);
    console.log(`\n【${sel}】`);
    for (const d of body.split(';')) {
      const s = d.trim();
      if (!s) continue;
      const j = s.indexOf(':');
      if (j < 0) { console.log(`    ${s}`); continue; }
      console.log(`    ${s.slice(0, j).trim().padEnd(26)} ${s.slice(j + 1).trim().slice(0, 70)}`);
    }
  }
}
