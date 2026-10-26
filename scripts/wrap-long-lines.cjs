// 把美化后仍存在的超长行（主要是 Vite chunk 依赖映射数组）按逗号换行至合理宽度
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || path.join(__dirname, '..', 'hana-frontend-recovered');
const MAX = parseInt(process.argv[3] || '200', 10);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

let fixed = 0;
for (const file of walk(ROOT)) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  let changed = false;
  const out = [];
  for (let line of lines) {
    if (line.length > MAX && line.includes(',')) {
      // 在逗号后换行
      const parts = line.split(/,(?![^\[]*\])/);
      const wrapped = [];
      let cur = '';
      for (const part of parts) {
        if (cur.length + part.length + 1 > MAX && cur) {
          wrapped.push(cur + ',');
          cur = part;
        } else {
          cur = cur ? cur + ',' + part : part;
        }
      }
      if (cur) wrapped.push(cur);
      out.push(...wrapped);
      changed = true;
      continue;
    }
    out.push(line);
  }
  if (changed) {
    fs.writeFileSync(file, out.join('\n'));
    fixed++;
  }
}
console.log(`已修正超长行文件数: ${fixed}`);
