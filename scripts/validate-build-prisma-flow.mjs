import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');
const rootPackage = JSON.parse(await read('package.json'));
const apiPackage = JSON.parse(await read('apps/api/package.json'));
const workflow = await read('.github/workflows/assistant-runtime-gates.yml');

assert.match(rootPackage.scripts.build, /^npm run db:generate && npm run build -w @cms\/api && npm run build -w @cms\/web$/, 'root build must generate Prisma Client before both application builds');
assert.equal(rootPackage.scripts['db:generate'], 'npm run prisma:generate -w @cms/api', 'root db:generate must invoke the API Prisma generator');
assert.equal(rootPackage.scripts['db:validate'], 'npm run prisma:validate -w @cms/api', 'root schema validation must use the API Prisma CLI');
assert.equal(apiPackage.scripts['prisma:generate'], 'prisma generate', 'API package must expose Prisma generation');
assert.equal(apiPackage.scripts['prisma:validate'], 'prisma validate', 'API package must expose schema validation');
assert.equal(apiPackage.scripts.pretest, 'npm run prisma:generate', 'standalone API tests must generate Prisma Client after clean install');
assert.match(workflow, /npm ci --no-audit --no-fund/, 'main CI must use the committed root lockfile');
assert.match(workflow, /npm run db:validate[\s\S]*npm run db:deploy/, 'main CI must validate schema before deploying isolated migrations');
assert.match(workflow, /if \[\[ ! -f experiments\/pi-durable-poc\/package-lock\.json \]\]/, 'PoC CI must fail clearly when its independent lockfile is missing');
assert.match(workflow, /npm ci --prefix experiments\/pi-durable-poc --no-audit --no-fund/, 'PoC CI must use its own committed lockfile');
assert.match(workflow, /npm test --prefix experiments\/pi-durable-poc/, 'PoC CI must run the full SQLite/Vitest and isolated PostgreSQL test suite');

console.log(JSON.stringify({
  gate: 'BUILD_AND_PRISMA_GENERATION_CONTRACT',
  result: 'PASS',
  assertions: 11,
  note: 'Static configuration contract only; does not substitute for running npm ci, Prisma generation, build, or database integration tests.'
}, null, 2));
