// 提取工具栏族 dead 规则在 legacy/v6 里的原文，供人工核对后再删
import { readFileSync } from 'node:fs';

const v2 = JSON.parse(readFileSync('D:/WorkSpace/hana/moheng/docs/gates/full-migration-map-v2.json', 'utf8'));
const TEST = (s) => /toolbar|filter-bar|page-actions|section-head|page-header/.test(s);

const deadSel = v2.dead.filter((x) => TEST(x.sel)).map((x) => ({ ...x, _norm: x.sel.replace(/\s+/g, '') }));
console.log(`工具栏族 dead: ${deadSel.length} 条\n`);

for (const sheet of ['legacy.css', 'v6.css']) {
  const path = `D:/WorkSpace/hana/moheng/apps/web/src/styles/${sheet}`;
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');

  const targets = deadSel.filter((x) => x.sheet === sheet);
  if (!targets.length) continue;

  console.log(`\n${'='.repeat(76)}\n${sheet} — ${targets.length} 条待删\n${'='.repeat(76)}`);

  // 简单规则扫描：找到以某个 selector 开头、到 } 结好的块
  for (const t of targets) {
    // 逐个可能的选择器片段去匹配
    const parts = t.sel.split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes('{')) continue;
      const selPart = line.slice(0, line.indexOf('{')).trim().replace(/\s+/g, ' ');
      if (parts.includes(selPart)) {
        // 收集到 } 为止
        let j = i, buf = [];
        while (j < lines.length && !lines[j].includes('}')) { buf.push(lines[j]); j++; }
        buf.push(lines[j] || '');
        const body = buf.join('\n');
        // 确认整个选择器列表一致
        const full = body.slice(0, body.indexOf('{')).trim().replace(/\s+/g, ' ');
        if (full === t.sel.replace(/\s+/g, ' ') || parts.some((p) => full.split(',').map((s) => s.trim()).includes(p))) {
          console.log(`\n  行 ${i + 1}  hits=${t.hits}  ${t.sel.slice(0, 70)}`);
          console.log(body.split('\n').map((l) => '    ' + l.trim()).filter((l) => l.trim()).join('\n'));
          found = true;
          break;
        }
      }
    }
    if (!found) console.log(`\n  [未定位] ${t.sel.slice(0, 70)}`);
  }
}
