# Prisma 7 RC.2 — PostgreSQL backup/restore rehearsal

## Purpose

Provide a repeatable pre-release rehearsal for PostgreSQL logical backup and restore after Prisma migrations have been applied. The automated gate only uses a disposable GitHub Actions PostgreSQL 16 service and synthetic data; it must not be represented as a production-data restore rehearsal.

## Automated gate

Workflow: \`.github/workflows/prisma7-migration-bootstrap.yml\`

The job performs these steps in order:

1. Run \`npm ci\` twice and verify the committed lockfile does not change.
2. Validate the Prisma schema and apply all committed migrations to the isolated \`moheng_test\` database.
3. Seed a synthetic project, main contract, six budget items, cost entries, a progress bill, and a change record.
4. Create a PostgreSQL custom-format logical dump with \`pg_dump\`.
5. Restore the dump into a fresh database named \`moheng_restore\` using \`pg_restore --single-transaction\`.
6. Compare the public base-table manifests and canonical JSONB content hashes for every table, then assert that the representative business fixture and successful Prisma migration ledger survive restoration.
7. Emit a non-sensitive text report to \`.assistant-gate-artifacts/postgres-backup-restore.txt\`. The dump itself is temporary and is not uploaded as an artifact.

The script hard-fails unless the source URL and PostgreSQL connection environment identify the disposable loopback database \`moheng_test\` on port 5432. It will not target an external host or another named database.

## Mechanical acceptance criteria

- The source database contains all six expected demo fixture categories.
- \`pg_dump\` exits 0 and its archive listing is non-empty.
- \`pg_restore\` exits 0 when restoring into a freshly created database.
- Source and restored public base-table manifests match exactly.
- Per-table canonical JSONB row-content hashes match for every public base table, including Prisma's migration ledger.
- The restored database retains the demo project, contract amount, budget items, cost entries, progress bill, change record, and at least one successful, non-rolled-back Prisma migration.
- The report records PASS and the dump SHA-256 without credentials or business data.
- Any failed assertion fails the workflow; no retry masks the failure.

## What this gate does not prove

- It does not test a production backup, production-sized database, external object storage, production encryption-key custody, roles/ownership/privileges, network topology, RPO/RTO, or a disaster-recovery cutover.
- It does not prove Prisma migrations are reversible. A failed migration must be handled using an approved forward-fix or tested restore plan; do not improvise destructive rollback SQL in production.
- The report is not a sign-off for deployment. Before release, an authorized operator must rehearse backup and restore using a sanitized representative staging snapshot, verify application login and key ledgers after restore, record measured recovery time and data-loss window, and document the tested recovery owner/procedure.
- Application backup encryption has its own unit coverage; this gate validates PostgreSQL logical backup/restore, not end-to-end encrypted backup storage.

## Next release gate

After this CI gate passes, run a controlled staging rehearsal on sanitized representative data. Capture: source snapshot identifier, migration revision, backup artifact identifier and SHA-256, restore target, table/data integrity verification, application smoke-test evidence, measured RPO/RTO, operator, and rollback/forward-fix decision. Keep credentials, connection strings, and unredacted business data out of GitHub artifacts.
