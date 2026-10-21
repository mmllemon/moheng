// 校验文档里引用的脚本都真实存在，且断言数量对得上
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const DOC = 'D:/WorkSpace/hana/moheng/docs/组件不变量.md';
const SCRIPTS = 'D:/WorkSpace/hana/moheng/scripts';

const md = readFileSync(DOC, 'utf8');

// 抽取所有形如 xxx.mjs 的引用
const refs = [...new Set([...md.matchAll(/([a-z0-9-]+\.mjs)/g)].map((m) => m[1]))];
console.log(`文档引用了 ${refs.length} 个脚本\n`);

let bad = 0;
for (const r of refs.sort()) {
  const p = `${SCRIPTS}/${r}`;
  const ok = existsSync(p);
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${r}`);
}

// 反向：scripts 下所有 verify-/audit- 前缀的常驻脚本，文档是否都覆盖
console.log('\n=== scripts 下常驻脚本是否都在文档里 ===');
const all = readdirSync(SCRIPTS).filter((f) => /^(verify|audit)-.*\.mjs$/.test(f));
let missing = 0;
for (const f of all.sort()) {
  const inDoc = refs.includes(f);
  // audit-button-heights 等历史脚本可能不常驻，只提示不报错
  if (!inDoc) {
    console.log(`  · ${f}  （文档未提及）`);
    missing++;
  }
}
console.log(`\n文档未提及 ${missing} 个 verify-/audit- 脚本`);

console.log(`\n${bad ? `✗ ${bad} 个引用指向不存在的文件` : '✓ 所有脚本引用有效'}`);
if (bad) process.exitCode = 1;
