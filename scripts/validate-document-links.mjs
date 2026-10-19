import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ignoredDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'build',
  '.assistant-gate-artifacts',
  '.gate-package',
  '.gate-rerun-artifacts',
]);
const markdownExtensions = new Set(['.md', '.mdx']);
const brokenLinks = [];
let localLinksChecked = 0;

async function collectMarkdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      files.push(...await collectMarkdownFiles(resolve(directory, entry.name)));
      continue;
    }
    if (entry.isFile() && markdownExtensions.has(extname(entry.name).toLowerCase())) {
      files.push(resolve(directory, entry.name));
    }
  }
  return files;
}

function withoutCode(markdown) {
  const tick = String.fromCharCode(96);
  const tripleTick = tick.repeat(3);
  const fencedCode = new RegExp(tripleTick + '[\\s\\S]*?' + tripleTick, 'g');
  const inlineCode = new RegExp(tick + '[^' + tick + '\\n]*' + tick, 'g');
  return markdown
    .replace(fencedCode, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(inlineCode, '');
}

function markdownDestinations(markdown) {
  const text = withoutCode(markdown);
  const pattern = /!?\[[^\]]*\]\(([^)\n]+)\)/g;
  const results = [];
  for (const match of text.matchAll(pattern)) {
    let destination = match[1].trim();
    if (!destination) continue;
    if (destination.startsWith('<')) {
      const closing = destination.indexOf('>');
      if (closing > 0) destination = destination.slice(1, closing);
    } else {
      destination = destination.split(/\s+/)[0] ?? '';
    }
    if (destination) results.push({ destination });
  }
  return results;
}

function isInsideRoot(path) {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..' + sep) && pathFromRoot !== '..');
}

async function targetExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

const files = await collectMarkdownFiles(root);

for (const sourceFile of files) {
  const markdown = await readFile(sourceFile, 'utf8');
  for (const link of markdownDestinations(markdown)) {
    const original = link.destination;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(original) || original.startsWith('#')) continue;

    const pathname = original.split(/[?#]/, 1)[0] ?? '';
    if (!pathname) continue;
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      brokenLinks.push({ sourceFile, destination: original, reason: 'URL path has invalid percent-encoding' });
      continue;
    }

    // Root-relative application routes are not repository file links.
    if (decodedPath.startsWith('/') && !extname(decodedPath)) continue;
    const targetPath = decodedPath.startsWith('/')
      ? resolve(root, '.' + decodedPath)
      : resolve(dirname(sourceFile), decodedPath);
    if (!isInsideRoot(targetPath)) {
      brokenLinks.push({ sourceFile, destination: original, reason: 'link resolves outside repository root' });
      continue;
    }

    localLinksChecked += 1;
    if (!await targetExists(targetPath)) {
      brokenLinks.push({ sourceFile, destination: original, reason: 'target does not exist' });
    }
  }
}

if (brokenLinks.length) {
  console.error('FAIL Markdown local links: ' + brokenLinks.length + ' unresolved target(s) in ' + files.length + ' Markdown file(s).');
  for (const issue of brokenLinks) {
    console.error('- ' + relative(root, issue.sourceFile) + ' -> ' + issue.destination + ' (' + issue.reason + ')');
  }
  process.exitCode = 1;
} else {
  console.log('PASS Markdown local links: checked ' + localLinksChecked + ' local target(s) across ' + files.length + ' Markdown file(s).');
}
