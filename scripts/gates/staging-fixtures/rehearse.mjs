#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const apiDir = join(root, 'apps', 'api');
const migrationDir = join(apiDir, 'prisma', 'migrations');
const schemaPath = join(apiDir, 'prisma', 'schema.prisma');
const prismaCli = join(root, 'node_modules', 'prisma', 'build', 'index.js');
const schemaName = 'moheng_staging_test';
const reportPath = resolve(root, process.env.STAGING_RECONCILIATION_REPORT_PATH || '.assistant-gate-artifacts/staging-data-migration-reconciliation-ci.txt');
const suppliedUrl = process.env.DATABASE_URL;

function fail(message) {
  throw new Error(message);
}
function assert(condition, message) {
  if (!condition) fail(message);
}
function run(command, args, cwd = root, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
  });
  if (result.error) fail(command + ' failed to start: ' + result.error.message);
  if (result.status !== 0) {
    const output = [result.stdout || '', result.stderr || ''].filter(Boolean).join('\n').slice(-12000);
    fail(command + ' exited ' + result.status + '. Output:\n' + output);
  }
  const stdout = result.stdout || '';
  if (stdout.trim()) process.stdout.write(stdout);
  return stdout.trim();
}
function makePsqlArgs(url, tail) {
  return [
    '--no-psqlrc',
    '--quiet',
    '--set=ON_ERROR_STOP=1',
    '--host=' + url.hostname,
    '--port=' + String(Number(url.port || 5432)),
    '--username=' + decodeURIComponent(url.username),
    '--dbname=' + decodeURIComponent(url.pathname.replace(/^\/+/, '')),
    ...tail,
  ];
}
function psql(sql) {
  return run('psql', makePsqlArgs(targetUrl, ['--command=' + sql]), root, databaseEnv).trim();
}
function query(sql) {
  return run('psql', makePsqlArgs(targetUrl, [
    '--tuples-only',
    '--no-align',
    '--command=' + 'SET search_path TO ' + schemaName + '; ' + sql,
  ]), root, databaseEnv).trim();
}
function executeSqlFile(filePath) {
  run('psql', makePsqlArgs(targetUrl, ['--file=' + filePath]), root, databaseEnv);
}
function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(label + ': expected [' + expected + '], received [' + actual + ']');
  }
  console.log('PASS ' + label);
}
async function createMigrationPrefix(prefix, targetPath, entries) {
  await mkdir(targetPath, { recursive: true });
  await cp(join(migrationDir, 'migration_lock.toml'), join(targetPath, 'migration_lock.toml'));
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d{14}_/.test(entry.name)) continue;
    if (entry.name.slice(0, 14) <= prefix) {
      await cp(join(migrationDir, entry.name), join(targetPath, entry.name), { recursive: true });
    }
  }
}
async function deployWithConfig(configPath, migrationsPath) {
  const config = [
    "import 'dotenv/config';",
    "import { defineConfig, env } from 'prisma/config';",
    'export default defineConfig({',
    '  schema: ' + JSON.stringify(schemaPath) + ',',
    '  migrations: { path: ' + JSON.stringify(migrationsPath) + ' },',
    "  datasource: { url: env('DATABASE_URL') },",
    '});',
    '',
  ].join('\n');
  await writeFile(configPath, config, 'utf8');
  console.log('Applying migration prefix from ' + migrationsPath);
  run(process.execPath, [prismaCli, 'migrate', 'deploy', '--config', configPath], apiDir, prismaEnv);
}
function checkSafetyAndPrepareEnvironment() {
  assert(process.argv.includes('--reset-isolated-schema'),
    'Refusing to proceed without the explicit --reset-isolated-schema argument.');
  assert(process.env.STAGING_RECONCILIATION_ALLOW_RESET === 'YES',
    'Refusing to reset the test schema without STAGING_RECONCILIATION_ALLOW_RESET=YES.');
  assert(suppliedUrl, 'DATABASE_URL is required.');
  const parsed = new URL(suppliedUrl);
  const inputSchema = parsed.searchParams.get('schema');
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  const safeHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  const safeDatabases = new Set(['cost_management', 'moheng_upgrade_test']);
  assert(safeHosts.has(parsed.hostname), 'Refusing non-loopback database hosts.');
  assert(Number(parsed.port || 5432) === 5432, 'Refusing database ports other than 5432.');
  assert(safeDatabases.has(databaseName), 'Refusing database names outside the explicit test-database allowlist.');
  assert(inputSchema === 'public' || inputSchema === schemaName,
    'DATABASE_URL schema must be public (input only) or the exact isolated schema ' + schemaName + '.');
  assert(decodeURIComponent(parsed.username).length > 0, 'DATABASE_URL must name an explicit database user.');

  const urlForTargetSchema = new URL(parsed.toString());
  urlForTargetSchema.searchParams.set('schema', schemaName);
  const pw = parsed.password ? decodeURIComponent(parsed.password) : (process.env.PGPASSWORD || '');
  const sharedEnv = { ...process.env };
  if (pw) sharedEnv.PGPASSWORD = pw;
  sharedEnv.DATABASE_URL = urlForTargetSchema.toString();
  const target = new URL(sharedEnv.DATABASE_URL);

  return {
    databaseName,
    targetUrl: target,
    databaseEnv: sharedEnv,
    prismaEnv: sharedEnv,
  };
}

const safety = checkSafetyAndPrepareEnvironment();
const databaseName = safety.databaseName;
const targetUrl = safety.targetUrl;
const databaseEnv = safety.databaseEnv;
const prismaEnv = safety.prismaEnv;

async function main() {
  console.log('Target allowlist PASS: loopback database=' + databaseName + ', schema=' + schemaName);
  run('pg_isready', [
    '--host=' + targetUrl.hostname,
    '--port=' + String(Number(targetUrl.port || 5432)),
    '--username=' + decodeURIComponent(targetUrl.username),
    '--dbname=' + databaseName,
  ], root, databaseEnv);

  // The only destructive command is explicitly scoped to this named schema and requires two opt-ins above.
  psql('DROP SCHEMA IF EXISTS ' + schemaName + ' CASCADE; CREATE SCHEMA ' + schemaName + ';');
  console.log('PASS reset/create limited to isolated schema ' + schemaName);

  const entries = await readdir(migrationDir, { withFileTypes: true });
  const expectedMigrationCount = entries.filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name)).length;
  const tempRoot = await mkdtemp(join(apiDir, '.staging-reconciliation-'));
  try {
    const stage0 = join(tempRoot, 'through-refresh-tokens');
    const stage1 = join(tempRoot, 'through-external-confirmation');
    const stage2 = join(tempRoot, 'through-settlement-ledgers');
    const configPath = join(tempRoot, 'prisma.config.ts');

    // True old schema: actor and external-confirmation columns do not exist yet.
    await createMigrationPrefix('20261013010000', stage0, entries);
    await deployWithConfig(configPath, stage0);
    executeSqlFile(join(root, 'scripts', 'gates', 'staging-fixtures', 'seed-legacy-before-migration.sql'));

    // Actor backfill executes after audit events and legacy changes already exist.
    await createMigrationPrefix('20261013020000', stage1, entries);
    await deployWithConfig(configPath, stage1);
    executeSqlFile(join(root, 'scripts', 'gates', 'staging-fixtures', 'seed-after-contract-confirmation.sql'));

    // The party-migration inputs exist, but BusinessParty has not been created yet.
    await createMigrationPrefix('20261014010000', stage2, entries);
    await deployWithConfig(configPath, stage2);
    executeSqlFile(join(root, 'scripts', 'gates', 'staging-fixtures', 'seed-before-business-party-master.sql'));

    // Apply remaining actual migrations, then add formal party dossiers as a later business import.
    await deployWithConfig(configPath, migrationDir);
    executeSqlFile(join(root, 'scripts', 'gates', 'staging-fixtures', 'seed-business-parties.sql'));

    assertEqual(query('SELECT "originalContractAmount"::text || \'|\' || "contractAmount"::text FROM "Project" WHERE code = \'STG-01\''),
      '20000000.00|21200000.00',
      'STG-01 uses the 1,200,000 external confirmation, not the 1,500,000 internal amount');
    assertEqual(query('SELECT "originalContractAmount"::text || \'|\' || "contractAmount"::text FROM "Project" WHERE code = \'STG-02\''),
      '17500000.00|17000000.00',
      'STG-02 signed main-contract baseline takes precedence, then subtracts the effective 500,000 change');
    assertEqual(query('SELECT "originalContractAmount"::text || \'|\' || "contractAmount"::text FROM "Project" WHERE code = \'STG-03\''),
      '5000000.00|5000000.00',
      'STG-03 remains the no-main-contract baseline');

    assertEqual(query('SELECT "previousEffectiveAmount"::text || \'|\' || "reconciledEffectiveAmount"::text || \'|\' || reason FROM "ContractBaselineMigrationReconciliation" r JOIN "Project" p ON p.id = r."projectId" WHERE p.code = \'STG-01\''),
      '0.00|21200000.00|RECALCULATE_EFFECTIVE_EXTERNAL_CONFIRMATIONS',
      'STG-01 reconciliation journal preserves prior value and reason');
    assertEqual(query('SELECT "previousOriginalAmount"::text || \'|\' || "mainContractAmount"::text || \'|\' || "reconciledOriginalAmount"::text || \'|\' || "reconciledEffectiveAmount"::text || \'|\' || reason FROM "ContractBaselineMigrationReconciliation" r JOIN "Project" p ON p.id = r."projectId" WHERE p.code = \'STG-02\''),
      '18000000.00|17500000.00|17500000.00|17000000.00|MAIN_CONTRACT_LEDGER_TAKES_PRECEDENCE',
      'STG-02 reconciliation journal proves formal contract precedence');

    assertEqual(query('SELECT "approvedAmount"::text || \'|\' || "externalConfirmedAmount"::text FROM "Change" WHERE code = \'STG01-BG-0001\''),
      '1500000.00|1200000.00',
      'internal-approval/external-confirmation discrepancy stays visible');
    assertEqual(query('SELECT "createdById" || \'|\' || "submittedById" FROM "Change" WHERE code = \'STG01-BG-0001\''),
      'stg-user-002|stg-user-003',
      'historical creator and submitter are backfilled from matching audit events');
    assertEqual(query('SELECT COALESCE("createdById", \'NULL\') || \'|\' || COALESCE("submittedById", \'NULL\') FROM "Change" WHERE code = \'STG02-BG-0002\''),
      'NULL|NULL',
      'missing change actors remain unresolved when no audit evidence exists');

    assertEqual(query('SELECT COUNT(*)::text FROM "BusinessParty" WHERE "normalizedName" = \'西部数据科技有限公司\''),
      '2',
      'same-name legacy/formal party records remain separate pending manual review');
    assertEqual(query('SELECT (bp."identityVerified" = false AND bp."creditCode" IS NULL)::text FROM "Project" p JOIN "BusinessParty" bp ON bp.id = p."ownerPartyId" WHERE p.code = \'STG-02\''),
      'true',
      'project remains linked to the conservative unverified legacy identity');
    assertEqual(query('SELECT (p1."normalizedName" <> p2."normalizedName" AND p1.id <> p2.id)::text FROM "BusinessParty" p1 CROSS JOIN "BusinessParty" p2 WHERE p1.id = \'stg-party-01\' AND p2.id = \'stg-party-02\''),
      'true',
      'similar but distinct registered legal names are not merged');
    assertEqual(query('SELECT bp.name FROM "CostEntry" ce JOIN "BusinessParty" bp ON bp.id = ce."businessPartyId" WHERE ce.id = \'stg-cost-01\''),
      '华东建设集团股份有限公司',
      'a cost linked to a downstream contract uses that contract counterparty, not conflicting free text');
    assertEqual(query('SELECT bp.name FROM "Project" p JOIN "BusinessParty" bp ON bp.id = p."ownerPartyId" WHERE p.code = \'STG-03\''),
      '市政工程管理处',
      'short owner name remains a separate unverified record rather than fuzzy-linking to a formal alias');

    const applied = Number(query('SELECT COUNT(*) FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL'));
    assertEqual(String(applied), String(expectedMigrationCount), 'all current migrations applied in the isolated schema');

    for (const name of ['_v1.sql', '_v3.sql', '_v4.sql', '_v8.sql']) {
      console.log('--- Read-only inspection query ' + name + ' ---');
      executeSqlFile(join(root, 'scripts', 'gates', 'staging-fixtures', name));
    }

    const report = [
      'gate=STAGING_DATA_MIGRATION_RECONCILIATION',
      'result=PASS',
      'database=' + databaseName,
      'schema=' + schemaName,
      'migration_history=real_migration_prefixes_applied_in_order',
      'STG-01=original:20000000.00;effective:21200000.00;external_confirmed:1200000.00;internal_approved:1500000.00',
      'STG-02=original:17500000.00;effective:17000000.00;reason:MAIN_CONTRACT_LEDGER_TAKES_PRECEDENCE',
      'STG-03=original:5000000.00;effective:5000000.00',
      'reconciliation_journal=old_and_recalculated_values_preserved',
      'actor_backfill=creator_and_submitter_recovered_only_from_matching_audit_events',
      'missing_actor=STG02-BG-0002 remains unresolved without audit evidence',
      'party_identity=same_name_legacy_and_formal_records_remain_separate; identity_verified_false_for_legacy_rows',
      'linked_cost=downstream_contract_counterparty_takes_precedence_over_conflicting_vendor_text',
      'applied_migrations=' + applied,
      'scope=disposable_or_explicitly_confirmed_loopback_test_schema_only; no production schema targeted',
    ].join('\n') + '\n';
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, report, 'utf8');
    console.log(report);
    console.log('PASS staging data migration reconciliation rehearsal');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
