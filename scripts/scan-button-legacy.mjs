// 查清 legacy/v6 里 .button 家族规则：哪些还生效、哪些被完全覆盖
import { readFileSync } from 'node:fs';

const FILES = {
  'legacy.css': 'D:/WorkSpace/hana/moheng/apps/web/src/styles/legacy.css',
  'v6.css': 'D:/WorkSpace/hana/moheng/apps/web/src/styles/v6.css',
  'hana.css': 'D:/WorkSpace/hana/moheng/apps/web/src/styles/hana.css',
};

function parse(css) {
  const s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const stack = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') { stack.push(buf.trim()); buf = ''; }
    else if (ch === '}') {
      const body = buf.trim();
      const sel = stack.pop() || '';
      buf = '';
      if (body && sel && !sel.startsWith('@')) out.push({ sel: sel.replace(/\s+/g, ' '), body });
    } else buf += ch;
  }
  return out;
}

// 提取属性名集合
const props = (body) => {
  const set = new Set();
  for (const p of body.split(';')) {
    const i = p.indexOf(':');
    if (i > 0) set.add(p.slice(0, i).trim().toLowerCase());
  }
  return set;
};

const isButtonFamily = (sel) =>
  /\.button(\b|[-:]|\.)/.test(sel) && !/\.button-small\s*\{?\s*$/.test('');

const result = {};
for (const [name, path] of Object.entries(FILES)) {
  const rules = parse(readFileSync(path, 'utf8'))
    .filter((r) => /\.button/.test(r.sel));
  result[name] = rules;
  console.log(`${name}: ${rules.length} 条含 .button 的规则`);
}

// 列出 legacy 里所有 .button 规则
console.log('\n' + '='.repeat(78));
console.log('legacy.css 里的 .button 规则');
console.log('='.repeat(78));
for (const r of result['legacy.css']) {
  const p = [...props(r.body)].join(' ');
  console.log(`\n  ${r.sel.slice(0, 100)}`);
  console.log(`      { ${p} }`);
}

console.log('\n' + '='.repeat(78));
console.log('v6.css 里的 .button 规则');
console.log('='.repeat(78));
for (const r of result['v6.css']) {
  const p = [...props(r.body)].join(' ');
  console.log(`\n  ${r.sel.slice(0, 100)}`);
  console.log(`      { ${p} }`);
}
