// 旧层退役审计 v2：精确化 dead 判定
// 相比 v1，增加三道误报防线：
//   1. 排除第三方 DOM 注入类（xterm/cm-/ProseMirror/univer 等前缀）
//   2. 排除被动态拼接的类名前缀族（代码里出现 `xxx-${` 或 `'xxx-' +` 形式）
//   3. 排除出现在 HTML 字符串里的（innerHTML/template 中的 class=）
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const SRC = 'D:/WorkSpace/hana/moheng/apps/web/src';
const STYLES = join(SRC, 'styles');
const OUT = 'D:/WorkSpace/hana/moheng/docs/gates';

const THIRD_PARTY = /^(xterm|cm-|ProseMirror|univer|tiptap|CodeMirror|monaco|ant-|rc-|Toastify|recharts)/i;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      walk(full, acc);
    } else acc.push(full);
  }
  return acc;
}

const allFiles = walk(SRC);
const codeFiles = allFiles.filter((f) => ['.ts', '.tsx', '.mjs', '.js'].includes(extname(f)));
const codeText = codeFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
// index.html 也算
const htmlFiles = allFiles.filter((f) => extname(f) === '.html');
const htmlText = htmlFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
const allText = codeText + '\n' + htmlText;

// 找出所有动态拼接的类名前缀：`foo-${`, 'foo-' +, `foo-`+ 等
const dynPrefixes = new Set();
for (const m of codeText.matchAll(/['"`]([a-zA-Z][\w-]*?)-\$\{/g)) dynPrefixes.add(m[1] + '-');
for (const m of codeText.matchAll(/['"`]([a-zA-Z][\w-]*?-)['"`]\s*\+/g)) dynPrefixes.add(m[1]);

const cssFiles = readdirSync(STYLES).filter((f) => f.endsWith('.css')).map((f) => join(STYLES, f));

const report = [];
for (const file of cssFiles) {
  const css = readFileSync(file, 'utf8');
  const classes = [...new Set([...css.matchAll(/\.([a-zA-Z][\w-]{1,})/g)].map((m) => m[1]))];

  const dead = [];
  const keptThirdParty = [];
  const keptDynamic = [];
  for (const cls of classes) {
    const wordRe = new RegExp(`(?<![\\w-])${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
    if (wordRe.test(allText)) continue; // 有字面引用，保留
    if (THIRD_PARTY.test(cls)) { keptThirdParty.push(cls); continue; }
    // 是否命中某个动态前缀
    const hitDyn = [...dynPrefixes].some((p) => cls.startsWith(p));
    if (hitDyn) { keptDynamic.push(cls); continue; }
    dead.push(cls);
  }

  report.push({
    file: relative(SRC, file),
    total: classes.length,
    dead: dead.length,
    thirdParty: keptThirdParty.length,
    dynamic: keptDynamic.length,
    deadClasses: dead.sort(),
  });
}

// 输出
for (const r of report) {
  const name = r.file.replace(/[\\/]/g, '_').replace(/\.css$/, '');
  writeFileSync(join(OUT, `dead-v2-${name}.txt`), r.deadClasses.join('\n') + '\n', 'utf8');
}

const summary = report.map((r) => ({
  file: r.file,
  total: r.total,
  dead: r.dead,
  deadPct: Number(((r.dead / r.total) * 100).toFixed(1)),
  thirdPartyExcluded: r.thirdParty,
  dynamicExcluded: r.dynamic,
}));
writeFileSync(join(OUT, 'dead-v2-summary.json'), JSON.stringify({ dynPrefixes: [...dynPrefixes], summary }, null, 2), 'utf8');

console.log(JSON.stringify({ dynPrefixes: [...dynPrefixes].slice(0, 20), summary }, null, 2));
