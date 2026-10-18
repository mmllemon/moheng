#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = join(root, 'apps', 'api');
const migrationDir = join(apiDir, 'prisma', 'migrations');
const schemaPath = join(apiDir, 'prisma', 'schema.prisma');
const prismaCli = join(root, 'node_modules', 'prisma', 'build', 'index.js');
const databaseName = 'moheng_upgrade_test';
const databaseUrl = process.env.DATABASE_URL;
const reportPath = resolve(root, process.env.LEGACY_MIGRATION_REPORT_PATH || '.assistant-gate-artifacts/legacy-migration-upgrade.txt');

function fail(message) {
  throw new Error(message);
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 12 * 1024 * 1024,
    shell: false,
  });
  if (result.error) fail(command + ' failed to start: ' + result.error.message);
  if (result.status !== 0) {
    const output = [result.stdout || '', result.stderr || ''].filter(Boolean).join('\n').slice(-9000);
    fail(command + ' exited ' + result.status + '. Output:\n' + output);
  }
  return (result.stdout || '').trim();
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) fail(label + ': expected [' + expected + '], received [' + actual + ']');
  console.log('PASS ' + label);
}

function query(sql) {
  return run('psql', [
    '--no-psqlrc', '--set=ON_ERROR_STOP=1', '--tuples-only', '--no-align',
    '--dbname=' + databaseName, '--command=' + sql,
  ]);
}

function executeSqlFile(filePath) {
  run('psql', ['--no-psqlrc', '--set=ON_ERROR_STOP=1', '--dbname=' + databaseName, '--file=' + filePath]);
}

function assertSafeTarget() {
  if (!databaseUrl) fail('DATABASE_URL is required.');
  const parsed = new URL(databaseUrl);
  const targetName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  const safeHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!safeHosts.has(parsed.hostname) ||
      targetName !== databaseName ||
      decodeURIComponent(parsed.username) !== 'postgres' ||
      Number(parsed.port || 5432) !== 5432 ||
      process.env.PGHOST !== '127.0.0.1' ||
      process.env.PGUSER !== 'postgres' ||
      process.env.PGPORT !== '5432') {
    fail('Refusing populated legacy migration rehearsal outside the disposable loopback ' + databaseName + ' database.');
  }
  console.log('PASS database safety guard: disposable upgrade database only');
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
  console.log('Deploying migration history through ' + migrationsPath);
  run(process.execPath, [prismaCli, 'migrate', 'deploy', '--config', configPath], apiDir);
}

async function main() {
  assertSafeTarget();
  run('pg_isready', ['--host=127.0.0.1', '--port=5432', '--username=postgres', '--dbname=' + databaseName]);

  const entries = await readdir(migrationDir, { withFileTypes: true });
  const expectedMigrationCount = entries.filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name)).length;
  const tempRoot = await mkdtemp(join(apiDir, '.legacy-migration-rehearsal-'));

  try {
    const stageOnePath = join(tempRoot, 'migrations-through-contract-confirmation');
    const stageTwoPath = join(tempRoot, 'migrations-through-settlement-ledgers');
    const configPath = join(tempRoot, 'prisma.config.ts');

    // Phase 1: install the historic schema, then add rows before contract and actor reconciliation.
    await createMigrationPrefix('20261013020000', stageOnePath, entries);
    await deployWithConfig(configPath, stageOnePath);
    executeSqlFile(join(root, 'scripts', 'gates', 'legacy-migration-fixtures', 'after-contract-confirmation.sql'));

    // Phase 2: add downstream contracts/costs after those tables and links exist, before party matching.
    await createMigrationPrefix('20261014010000', stageTwoPath, entries);
    await deployWithConfig(configPath, stageTwoPath);
    executeSqlFile(join(root, 'scripts', 'gates', 'legacy-migration-fixtures', 'before-business-party-master.sql'));

    // Phase 3: run the remaining real migration files against populated legacy-shaped data.
    await deployWithConfig(configPath, migrationDir);

    assertEqual(
      query('SELECT "originalContractAmount"::text || \'|\' || "contractAmount"::text FROM "Project" WHERE code = \'UPGRADE-01\''),
      '12000000.00|12400000.00',
      'effective amount includes effective increases/decreases but excludes pending/deleted changes',
    );
    assertEqual(
      query('SELECT "previousOriginalAmount"::text || \'|\' || "mainContractAmount"::text || \'|\' || "reconciledOriginalAmount"::text || \'|\' || "previousEffectiveAmount"::text || \'|\' || "reconciledEffectiveAmount"::text || \'|\' || reason FROM "ContractBaselineMigrationReconciliation" WHERE "projectId" = \'upgrade-project-01\''),
      '12580000.00|12000000.00|12000000.00|12580000.00|12400000.00|MAIN_CONTRACT_LEDGER_TAKES_PRECEDENCE',
      'reconciliation journal preserves prior and reconciled contract values',
    );
    assertEqual(
      query('SELECT "createdById" || \'|\' || "submittedById" FROM "Change" WHERE id = \'upgrade-change-increase\''),
      'upgrade-creator|upgrade-submitter',
      'historic change creator and submitter are reconstructed from separate audit events',
    );
    assertEqual(
      query('SELECT (p1."ownerPartyId" = p3."ownerPartyId" AND p1."ownerPartyId" <> p2."ownerPartyId" AND (SELECT bp."identityVerified" = false FROM "BusinessParty" bp WHERE bp.id = p1."ownerPartyId"))::text FROM "Project" p1 CROSS JOIN "Project" p2 CROSS JOIN "Project" p3 WHERE p1.code = \'UPGRADE-01\' AND p2.code = \'UPGRADE-02\' AND p3.code = \'UPGRADE-03\''),
      'true',
      'normalized owner names link consistently, distinct legal-name strings remain separate, and backfilled identities stay unverified',
    );
    assertEqual(
      query('SELECT ((dc."counterpartyPartyId" IS NOT NULL) AND linked."businessPartyId" = dc."counterpartyPartyId" AND unlinked."businessPartyId" = dc."counterpartyPartyId" AND (SELECT count(*) FROM "BusinessParty" bp WHERE bp."normalizedName" = \'acme power equipment ltd\') = 1)::text FROM "DownstreamContract" dc JOIN "CostEntry" linked ON linked.id = \'upgrade-cost-linked\' JOIN "CostEntry" unlinked ON unlinked.id = \'upgrade-cost-unlinked\' WHERE dc.id = \'upgrade-supplier-contract\''),
      'true',
      'linked costs inherit signed-contract counterparty; normalized unlinked costs reuse the same unverified party',
    );

    const applied = Number(query('SELECT count(*) FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL'));
    assertEqual(String(applied), String(expectedMigrationCount), 'all committed migrations apply to populated historical rows');

    const report = [
      'gate=POSTGRES_LEGACY_DATA_MIGRATION_UPGRADE',
      'result=PASS',
      'database=' + databaseName,
      'migration_history=staged_at_two_historical_boundaries_then_deployed_to_current_head',
      'contract_original_amount=12000000.00',
      'contract_effective_amount=12400000.00',
      'external_change_filter=pending_and_soft_deleted_excluded',
      'reconciliation_journal=previous_and_reconciled_values_preserved',
      'change_actor_backfill=creator_and_submitter_traceable_to_distinct_audit_events',
      'business_party_backfill=normalized_name_linkage_verified; identity_verified_remains_false',
      'linked_cost_identity=downstream_contract_counterparty_takes_precedence',
      'applied_migrations=' + applied,
      'scope=synthetic_legacy_rows_on_disposable_postgresql_16_not_staging_or_production_data',
    ].join('\n') + '\n';
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, report, 'utf8');
    console.log(report);
    console.log('PASS populated legacy-data migration upgrade rehearsal');
  } finally {
    // The whole database service is disposable and removed by the CI runner; only temporary copied migrations/config are cleaned here.
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
