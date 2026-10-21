// 按规则切分 Hana CSS，精准检索截图中的四组按钮
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'D:/WorkSpace/hana/hana-seed/renderer/assets';
const files = readdirSync(ROOT).filter((f) => f.endsWith('.css'));

function* rules(css) {
  let s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack = []; let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') { stack.push(buf.trim()); buf = ''; }
    else if (ch === '}') {
      const body = buf.trim();
      const sel = stack.pop() || ''; buf = '';
      if (body && sel && !sel.startsWith('@')) yield { sel, body };
    } else buf += ch;
  }
}

// 从截图识别出的关键词
const GROUPS = {
  '① 视图切换（列表/网格图标）': ['_viewMode', '_viewToggle', '_layoutToggle', '_gridView', '_listView', '_displayMode'],
  '② 分段标签（对话文件/工作室/…）': ['_segment', '_tab', '_tileTopTitleSegment', '_titleSegment', '_tabBar', '_modeSwitch'],
  '③ 窗口控件（最小化/最大化/关闭）': ['_windowControl', '_closeBtn', '_minBtn', '_maxBtn', '_titlebarAction', '_close_', '_closeButton'],
  '④ 行内操作图标（下载/删除/更多）': ['_fileAction', '_fileOutputAction', '_rowAction', '_rowIconButton', '_iconAction', '_actionBtn'],
};

const hits = [];
for (const f of files) {
  const css = readFileSync(join(ROOT, f), 'utf8');
  for (const r of rules(css)) {
    for (const [group, keys] of Object.entries(GROUPS)) {
      if (!keys.some((k) => r.sel.includes(k))) continue;
      const d = {};
      for (const p of r.body.split(';')) {
        const i = p.indexOf(':');
        if (i < 0) continue;
        d[p.slice(0, i).trim()] = p.slice(i + 1).trim();
      }
      hits.push({ group, file: f, sel: r.sel.replace(/\s+/g, ' '), d });
      break;
    }
  }
}

for (const [group] of Object.entries(GROUPS)) {
  const list = hits.filter((h) => h.group === group);
  console.log(`\n${'='.repeat(78)}\n${group}   ${list.length} 条\n${'='.repeat(78)}`);
  const seen = new Set();
  for (const h of list) {
    const key = h.sel.slice(0, 70);
    if (seen.has(key)) continue;
    seen.add(key);
    const geo = ['height', 'min-height', 'width', 'min-width', 'padding', 'border-radius',
      'font-size', 'gap', 'justify-content', 'align-items', 'display', 'flex', 'background', 'color', 'border']
      .filter((k) => h.d[k])
      .map((k) => `${k}:${h.d[k].slice(0, 46)}`);
    if (!geo.length) continue;
    console.log(`\n[${h.file.replace(/\.css$/, '')}]`);
    console.log(`  ${h.sel.slice(0, 100)}`);
    for (const g of geo) console.log(`      ${g}`);
  }
}
