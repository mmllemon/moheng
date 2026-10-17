import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const read = (path) => readFile(path, 'utf8');
const rootPackage = JSON.parse(await read('package.json'));
const apiPackage = JSON.parse(await read('apps/api/package.json'));
const webPackage = JSON.parse(await read('apps/web/package.json'));
const schema = await read('apps/api/prisma/schema.prisma');
const prismaConfig = await read('apps/api/prisma.config.ts');
const prismaClient = await read('apps/api/src/lib/prisma.ts');
const dockerfile = await read('apps/api/Dockerfile');
const checks = [];
function check(name, fn) { fn(); checks.push(name); }

check('root workspace version is rc.2', () => assert.equal(rootPackage.version, '2.19.0-rc.2'));
check('API workspace version is rc.2', () => assert.equal(apiPackage.version, '2.19.0-rc.2'));
check('Web workspace version is rc.2', () => assert.equal(webPackage.version, '2.19.0-rc.2'));
check('Prisma CLI is pinned to 7.10.1', () => assert.equal(apiPackage.devDependencies.prisma, '7.10.1'));
check('Prisma Client is pinned to 7.10.1', () => assert.equal(apiPackage.dependencies['@prisma/client'], '7.10.1'));
check('PostgreSQL driver adapter matches Prisma 7.10.1', () => assert.equal(apiPackage.dependencies['@prisma/adapter-pg'], '7.10.1'));
check('PostgreSQL driver version is explicit', () => assert.equal(apiPackage.dependencies.pg, '8.23.1'));
check('PostgreSQL driver types version is explicit', () => assert.equal(apiPackage.devDependencies['@types/pg'], '8.23.1'));
check('install script allowlist is pinned to Prisma 7', () => {
  assert.equal(rootPackage.allowScripts['@prisma/client@7.10.1'], true);
  assert.equal(rootPackage.allowScripts['@prisma/engines@7.10.1'], true);
  assert.equal(rootPackage.allowScripts['prisma@7.10.1'], true);
  assert.equal(rootPackage.allowScripts['@prisma/client@6.19.3'], undefined);
  assert.equal(rootPackage.allowScripts['@prisma/engines@6.19.3'], undefined);
  assert.equal(rootPackage.allowScripts['prisma@6.19.3'], undefined);
});
check('generator uses prisma-client custom source output', () => {
  const generator = schema.match(/generator client \{([\s\S]*?)\}/)?.[1] ?? '';
  assert.match(generator, /provider\s*=\s*"prisma-client"/);
  assert.match(generator, /output\s*=\s*"\.\.\/src\/generated\/prisma"/);
  assert.match(generator, /moduleFormat\s*=\s*"esm"/);
  assert.match(generator, /generatedFileExtension\s*=\s*"ts"/);
  assert.match(generator, /importFileExtension\s*=\s*"js"/);
});
check('schema datasource no longer embeds URL', () => {
  const datasource = schema.match(/datasource db \{([\s\S]*?)\}/)?.[1] ?? '';
  assert.match(datasource, /provider\s*=\s*"postgresql"/);
  assert.doesNotMatch(datasource, /\burl\s*=/);
});
check('Prisma config supplies datasource URL via env', () => {
  assert.match(prismaConfig, /defineConfig/);
  assert.match(prismaConfig, /schema: 'prisma\/schema\.prisma'/);
  assert.match(prismaConfig, /migrations:[\s\S]*path: 'prisma\/migrations'/);
  assert.match(prismaConfig, /url: env\('DATABASE_URL'\)/);
});
check('Prisma Client instance uses PostgreSQL driver adapter', () => {
  assert.match(prismaClient, /from '@prisma\/adapter-pg'/);
  assert.match(prismaClient, /from '\.\.\/generated\/prisma\/client\.js'/);
  assert.match(prismaClient, /new PrismaPg\(\{ connectionString \}\)/);
  assert.match(prismaClient, /new PrismaClient\(\{[\s\S]*?adapter,/);
});
check('Docker build installs from root lock with npm ci', () => {
  assert.match(dockerfile, /COPY package\.json package-lock\.json/);
  assert.match(dockerfile, /npm ci --no-audit --no-fund/);
  assert.match(dockerfile, /apps\/api\/prisma\.config\.ts/);
});
check('release-candidate suite includes Prisma 7 migration static gate', () => {
  assert.match(rootPackage.scripts['validate:release-candidate'], /validate-prisma7-migration\.mjs/);
});

const sourceRoot = 'apps/api/src';
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'generated' || entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(dir, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) await walk(path);
    else if (/\.tsx?$/.test(entry.name)) files.push(path);
  }
}
await walk(sourceRoot);
let generatedImports = 0;
for (const path of files) {
  const content = await read(path);
  assert.doesNotMatch(content, /(?:from|import\s*\()\s*['"]@prisma\/client['"]/, path + ' still imports from @prisma/client');
  if (content.includes('../generated/prisma/client.js')) generatedImports++;
}
check('all API TypeScript files use the generated-client import path', () => assert.ok(generatedImports >= 30, 'expected at least 30 migrated import files; found ' + generatedImports));

console.log(JSON.stringify({ gate: 'PRISMA7_MIGRATION_STATIC_CONTRACT', result: 'PASS', assertions: checks.length, migratedImportFiles: generatedImports, scannedSourceFiles: files.length, checks }, null, 2));
