import fs from 'fs';
import path from 'path';

const DRY = !process.argv.includes('--apply');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx') && !e.name.includes('.test.')) out.push(p);
  }
  return out;
}

const files = walk('apps/web/src');
let total = 0;
const detail = [];

for (const f of files) {
  let c = fs.readFileSync(f, 'utf8');
  const before = c;
  let n = 0;

  // ① 标准：<div className="data-note"><span className="note-mark">i</span><span>...</span></div>
  c = c.replace(
    /<div className="data-note"><span className="note-mark">i<\/span><span>([\s\S]*?)<\/span><\/div>/g,
    (m, inner) => { n++; return `<PageNote>${inner}</PageNote>`; }
  );

  // ② 图标版：<span className="note-mark"><Icon size={14} /></span>
  c = c.replace(
    /<div className="data-note"><span className="note-mark"><(\w+) size=\{14\} \/><\/span><span>([\s\S]*?)<\/span><\/div>/g,
    (m, icon, inner) => { n++; return `<PageNote icon={${icon}}>${inner}</PageNote>`; }
  );

  if (n) {
    // 补 import
    const m = c.match(/import \{([^}]*)\} from '\.\.\/components\/Ui';/);
    if (m && !m[1].includes('PageNote')) {
      const parts = m[1].split(',').map((s) => s.trim()).filter(Boolean);
      parts.push('PageNote');
      parts.sort((a, b) => a.localeCompare(b));
      c = c.replace(m[0], `import { ${parts.join(', ')} } from '../components/Ui';`);
    }
    if (!DRY) fs.writeFileSync(f, c, 'utf8');
    detail.push({ file: path.basename(f), n });
    total += n;
  }
}

console.log(`${DRY ? '(dry-run) ' : ''}迁移 ${total} 处`);
for (const d of detail) console.log(`  ${d.file.padEnd(40)} ${d.n}`);
