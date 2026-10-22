// 读 hana 会话标题栏的完整上下文：它在哪个容器里、宽度怎么约束
import { readFileSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35/assets';
const css = readFileSync(`${dir}/ChatTranscript-DhOABhoU.css`, 'utf8');

// 拆规则，保留顺序
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
    rules.push({ sel, decls, index: m.index });
  }
}

// 所有 chatTitle 相关规则，完整打印
console.log('=== chatTitle* 全部规则 ===\n');
for (const r of rules) {
  if (!/chatTitle/i.test(r.sel)) continue;
  console.log(`【${r.sel}】`);
  for (const [k, v] of Object.entries(r.decls)) {
    console.log(`    ${k.padEnd(20)} ${v.slice(0, 80)}`);
  }
  console.log('');
}

// 找标题层相关的定位/宽度约束
console.log('\n=== 可能承载标题的容器（position + max-width + top）===\n');
for (const r of rules) {
  const d = r.decls;
  if (!d.position) continue;
  if (!/title|header|top/i.test(r.sel)) continue;
  console.log(`【${r.sel}】`);
  for (const [k, v] of Object.entries(d)) {
    console.log(`    ${k.padEnd(20)} ${v.slice(0, 80)}`);
  }
  console.log('');
}
