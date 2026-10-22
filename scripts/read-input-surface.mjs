// 找 CardShell 里的卡片容器：input-surface / card 的样式来源
import { readFileSync, readdirSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35/assets';

for (const f of readdirSync(dir).filter((x) => x.endsWith('.css'))) {
  const css = readFileSync(`${dir}/${f}`, 'utf8');
  for (const key of ['input-surface', 'input-stack', 'input-area', 'input-wrapper']) {
    if (!css.includes(key)) continue;
    const re = new RegExp(`[^{}]*${key}[^{]*\\{[^}]*\\}`, 'g');
    const ms = css.match(re) ?? [];
    if (!ms.length) continue;
    console.log(`\n${'='.repeat(72)}\n### ${f} ← ${key}`);
    for (const m of ms.slice(0, 8)) {
      const i = m.indexOf('{');
      console.log(`\n  【${m.slice(0, i).trim()}】`);
      for (const d of m.slice(i + 1, -1).split(';')) {
        const s = d.trim();
        if (!s) continue;
        console.log(`      ${s.slice(0, 92)}`);
      }
    }
  }
}
