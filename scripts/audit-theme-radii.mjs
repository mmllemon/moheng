// 各主题的圆角 token 实际值
import { readdirSync, readFileSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35/themes';
const TOKENS = ['--radius-xs', '--radius-sm', '--radius-md', '--radius-lg', '--radius-input', '--radius-card'];

console.log('主题'.padEnd(28) + TOKENS.map((t) => t.replace('--radius-', '').padStart(7)).join(''));
console.log('-'.repeat(70));

for (const f of readdirSync(dir).filter((x) => x.endsWith('.css'))) {
  const css = readFileSync(`${dir}/${f}`, 'utf8');
  const vals = TOKENS.map((t) => {
    const m = new RegExp(`${t}\\s*:\\s*([^;]+);`).exec(css);
    return m ? m[1].trim().replace(/\s*\/\*.*$/, '') : '-';
  });
  const hasAny = vals.some((v) => v !== '-');
  console.log(f.replace('.css', '').padEnd(28) + vals.map((v) => v.padStart(7)).join('') + (hasAny ? '' : '  (沿用基础)'));
}

// 基础值
const base = readFileSync('D:/WorkSpace/hana/moheng/reference/hana-1.1.35/styles.css', 'utf8');
console.log('\nstyles.css 基础值:');
for (const t of TOKENS) {
  const m = new RegExp(`^\\s*${t}\\s*:\\s*([^;]+);`, 'm').exec(base);
  if (m) console.log(`  ${t.padEnd(18)} ${m[1].trim()}`);
}

// 算出侧栏实际圆角（--radius-lg × 1.8408964）
console.log('\n侧栏 .float-sidebar-panel-left 实际圆角 = radius-lg × 1.8408964:');
for (const f of readdirSync(dir).filter((x) => x.endsWith('.css'))) {
  const css = readFileSync(`${dir}/${f}`, 'utf8');
  const m = new RegExp(`--radius-lg\\s*:\\s*([\\d.]+)px`).exec(css);
  const lg = m ? parseFloat(m[1]) : 12;
  console.log(`  ${f.replace('.css', '').padEnd(28)} ${lg} × 1.8409 = ${(lg * 1.8408964).toFixed(1)}px`);
}
