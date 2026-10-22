// 读侧栏 transition 完整声明 + 所有 chalkboard motion 常量
import { readFileSync, readdirSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35';

console.log('=== _fp_ 的完整 transition 声明 ===');
const css = readFileSync(`${dir}/assets/ChatTranscript-DhOABhoU.css`, 'utf8');
const i = css.indexOf('._fp_f9c75{');
if (i >= 0) {
  const end = css.indexOf('}', i);
  const body = css.slice(i, end + 1);
  for (const d of body.split(';')) {
    const s = d.trim();
    if (s.includes('transition') || s.includes('width') || s.includes('margin')) console.log(`  ${s}`);
  }
}

console.log('\n=== 所有 motion 常量定义 ===');
const files = [];
function walk(p) {
  for (const e of readdirSync(p, { withFileTypes: true })) {
    if (e.isDirectory()) walk(`${p}/${e.name}`);
    else if (e.name.endsWith('.css')) files.push(`${p}/${e.name}`);
  }
}
walk(dir);
for (const f of files) {
  const c = readFileSync(f, 'utf8');
  const ms = c.match(/--chalkboard-motion-[\w-]+\s*:\s*[^;}]+/g);
  if (!ms) continue;
  const uniq = [...new Set(ms)];
  console.log(`\n[${f.replace(dir + '/', '')}]`);
  for (const m of uniq) console.log(`  ${m}`);
}
