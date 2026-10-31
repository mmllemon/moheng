// 一次性 codemod：把 routes/ 顶层的 system-management-* / downstream-finance-* 子实现文件
// 的 import 说明符改写到 routes/<module>/ 子目录布局。仅改路径字符串，不动语义。
const fs = require('node:fs');
const path = require('node:path');

const ROUTES = path.join(process.cwd(), 'apps', 'api', 'src', 'routes');

// 子目录内的文件：兄弟引用去掉模块前缀；上一级引用（lib/generated/platform）再多退一层。
const SIBLING = {
  'system-management': {
    './system-management.schemas.js': './schemas.js',
    './system-management.helpers.js': './helpers.js',
  },
  'downstream-finance': {
    './downstream-finance.schemas.js': './schemas.js',
    './downstream-finance.helpers.js': './helpers.js',
  },
};

// 留在 routes/ 顶层的父模块：指向子目录的新路径。
const PARENT = {
  'system-management.ts': {
    './system-management.helpers.js': './system-management/helpers.js',
    './system-management-governance.js': './system-management/governance.js',
    './system-management-integrations.js': './system-management/integrations.js',
    './system-management-operations.js': './system-management/operations.js',
  },
  'downstream-finance.ts': {
    './downstream-finance.schemas.js': './downstream-finance/schemas.js',
    './downstream-finance.helpers.js': './downstream-finance/helpers.js',
    './downstream-finance-settlements.js': './downstream-finance/settlements.js',
    './downstream-finance-invoices.js': './downstream-finance/invoices.js',
    './downstream-finance-retention.js': './downstream-finance/retention.js',
  },
};

function rewrite(src, map, deepenParent) {
  let out = src;
  let n = 0;
  for (const [from, to] of Object.entries(map)) {
    const a = `from '${from}'`;
    const b = `from '${to}'`;
    const count = out.split(a).length - 1;
    if (count) {
      out = out.split(a).join(b);
      n += count;
    }
  }
  if (deepenParent) {
    // 必须用字符串形式的替换：函数形式里 '$1' 不会被替换，会把字面量写进文件。
    // 捕获组不包含开头的 '../'，否则 '../../$1' 会多出三层。
    const hits = out.match(/from '\.\.\/[^']+\.js'/g);
    if (hits) n += hits.length;
    out = out.replace(/from '\.\.\/([^']+\.js)'/g, "from '../../$1'");
  }
  return { out, n };
}

const changed = [];
for (const mod of Object.keys(SIBLING)) {
  const dir = path.join(ROUTES, mod);
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.ts')) continue;
    const file = path.join(dir, name);
    const src = fs.readFileSync(file, 'utf8');
    const r = rewrite(src, SIBLING[mod], true);
    if (r.n) {
      fs.writeFileSync(file, r.out);
      changed.push(`routes/${mod}/${name}  (${r.n})`);
    }
  }
}
for (const [name, map] of Object.entries(PARENT)) {
  const file = path.join(ROUTES, name);
  const src = fs.readFileSync(file, 'utf8');
  const r = rewrite(src, map, false);
  if (r.n) {
    fs.writeFileSync(file, r.out);
    changed.push(`routes/${name}  (${r.n})`);
  }
}
console.log(changed.map((c) => `  rewrote ${c}`).join('\n') || '  no changes');
