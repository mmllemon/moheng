// 完整读取 hana 会话窗口的骨架层
import { readFileSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35/assets';
const css = readFileSync(`${dir}/ChatTranscript-DhOABhoU.css`, 'utf8');

// 拆成规则
const rules = [];
{
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1].trim();
    const body = m[2];
    const decls = {};
    for (const d of body.split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
    rules.push({ sel, decls });
  }
}

// 骨架层：容器、滚动、列、内边距、标题、底部
const LAYOUT_PROPS = /^(display|flex|flex-direction|flex-grow|flex-shrink|flex-basis|grid-template|gap|align-items|justify-content|position|top|right|bottom|left|inset|width|min-width|max-width|height|min-height|max-height|margin|padding|overflow|overflow-y|overflow-x|z-index|padding-top|padding-right|padding-bottom|padding-left|margin-top|margin-bottom)$/;

const KEY = /sessionPanel|sessionShell|sessionFooter|chatTitle|transcript|messageList|messageGroup|scroll|content|column/i;

console.log('=== hana 会话窗口骨架规则 ===\n');
for (const r of rules) {
  if (!KEY.test(r.sel)) continue;
  // 只取有布局属性的
  const layout = {};
  for (const [k, v] of Object.entries(r.decls)) {
    if (LAYOUT_PROPS.test(k)) layout[k] = v;
  }
  if (!Object.keys(layout).length) continue;
  console.log(`【${r.sel.slice(0, 70)}】`);
  for (const [k, v] of Object.entries(layout)) {
    console.log(`    ${k.padEnd(18)} ${v.slice(0, 70)}`);
  }
  console.log('');
}
