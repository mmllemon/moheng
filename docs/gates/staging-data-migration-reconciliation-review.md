# Review: staging data migration reconciliation report

> **历史证据说明：** 本文是 2026-10-18 对特定报告提交的复核快照。文中“current RC.2 head”、Actions run #40 和未勾选项目均指当时的代码、合成夹具与后续投产验证计划，不是 2026-10-20 当前主干状态，也不代表当前墨衡有真实历史数据需要人员签认。该报告及其 CI 只使用自建合成台账夹具和隔离 PostgreSQL。当前开发任务与后续阶段边界见[开发阶段验证与后续投产门禁](../发布与迁移验收.md)。

Reviewed report commit: `83cb10702efdf0129047feeaee6993a4aa9c8ca8`

Source report: `docs/gates/staging-data-migration-reconciliation.md`

## Conclusion

The original report records an isolated-schema rehearsal with synthetic legacy-ledger fixtures and identifies four concrete data-quality questions. At the original report commit, its local reproduction commands were not self-contained and parts of the seed order did not match the historical schemas.

**Follow-up status:** the current RC.2 head `bd4793af5e8d26497ed8a3556d180cb80a000527` now includes the phase-correct runner at `scripts/gates/staging-fixtures/rehearse.mjs` and the required staged SQL fixtures. GitHub Actions run [#40 — Prisma 7 migration gates](https://github.com/mmllemon/moheng/actions/runs/39091162665) passed both the main migration job and the populated-legacy/STG-shaped reconciliation job. The current tree therefore closes the *synthetic fixture reproducibility* gap; it does not turn synthetic data into evidence from the user's actual staging database.

The original review did not access or change any database. The automated rehearsal runs in GitHub Actions against a disposable PostgreSQL 16 service. No evidence in this review establishes that a real user staging or production database was accessed.

## Reproducibility gaps found at the originally reviewed report commit

These items describe the tree and reproduction sequence at report commit `83cb10702efdf0129047feeaee6993a4aa9c8ca8`; they should not be read as unresolved defects in the current runner.

1. The report's original reproduction commands referenced local helpers `stage1-legacy.mjs` and `sq.mjs`, which were not tracked. The current self-contained `scripts/gates/staging-fixtures/rehearse.mjs` supersedes those helpers for a repeatable CI/local synthetic rehearsal.
2. The old seed sequence was not valid for the schema immediately before `20261013020000_contract_change_external_confirmation`: it attempted to use post-migration fields and create party records before the migration that creates `BusinessParty`. The current runner separates those operations into migration-phase-specific fixtures.
3. The earlier `CostEntry` fixture used column names that did not match the committed initial migration. The phase-correct fixture now uses the historical schema's columns.
4. The earlier fixture used unsupported `BusinessPartyRole` values. The current formal-party fixture uses values supported by the committed enum.
5. The earlier fixture did not exercise the precise audit predicates for creator and submitter backfill. The current populated-legacy gate seeds audit events before the relevant migration and asserts that matching events recover the creator/submitter, while records without evidence remain unresolved.
6. The old command sequence could insert duplicate audit-log IDs and costs from two seed files. The current runner stages those fixtures in order and the corresponding reconciliation job passes.

## Classification of the four report findings

| Finding | Current treatment |
|---|---|
| A legacy unverified party and a formal party share the same normalized name | Keep both records until source contracts / credit codes are compared and an approved merge map is recorded. Never merge solely by normalized name. |
| `STG02-BG-0002` has no actor fields and no audit events | Keep attribution unresolved. Do not infer or auto-fill a person; record a manual exception until primary evidence exists. |
| `approvedAmount = 1,500,000` and `externalConfirmedAmount = 1,200,000` differ by 300,000 | Keep the difference visible for follow-up. The effective-contract calculation follows the selected rule: externally confirmed amount is the adjustment basis. Do not substitute the internal approved amount into the effective contract total. |
| Projects point to unverified legacy parties instead of formal party records | Conservative behaviour. Match by verified registration/credit code and source contract before updating any relationship; a name-only match is insufficient. |

## Read-only inspection queries

The committed query files are in `scripts/gates/staging-fixtures/`:

- `_v1.sql`: project/main-contract amount and recalculated effective amount.
- `_v3.sql`: reconciliation journal, including before/after values and reason codes.
- `_v4.sql`: change actor fields and matching audit-event counts.
- `_v8.sql`: normalized-name duplicates and auto-created unverified parties.

The queries set the test schema as their session `search_path` and contain SELECT statements only. Fixture seeding and schema reset must only run on a disposable test database; never run them against a non-disposable database.

## Gate status snapshot (verified 2026-10-18)

- [x] Self-contained runner applies real migration prefixes in historical order and inserts legacy-shaped rows before the relevant backfills.
- [x] Current-head GitHub Actions run [#40](https://github.com/mmllemon/moheng/actions/runs/39091162665) passed the main migration job (including build, API smoke, tests, backup/restore rehearsal and dependency audit) and the populated-legacy/STG-shaped reconciliation job.
- [x] The run published the `prisma7-pr-gates` and `prisma7-legacy-upgrade-evidence` artifacts. These contain test evidence, not a user staging dump.
- [x] Synthetic acceptance cases verify that STG-01 uses the externally confirmed 1,200,000 amount rather than the 1,500,000 internal-approved amount; STG-02 follows the signed main-contract baseline then the effective decrease; and STG-03 remains at its baseline.
- [ ] **Later pre-production gate, only if a real historical ledger/snapshot is supplied and authorized for migration:** run migration/reconciliation against a sanitized representative user staging snapshot and compare each project's before/after amounts/reasons. This is not a current development blocker when such data does not exist.
- [ ] **Later data-acceptance gate, only for findings reproduced in real user data:** have the authorized reviewer resolve or formally accept exceptions for same-name parties, missing actor evidence and unrecoverable `internalApprovedById` / `externalRecordedById` values. The STG identifiers in this report are synthetic fixtures.
- [ ] **Later deployment gate:** execute login, authorization, report preview/XLSX export, background-job, backup and restore smoke checks on the selected target topology, and document the forward-fix/restore procedure.
- [ ] If claiming that the protected `public` schema was untouched in a particular rehearsal, capture before/after fingerprints for that schema; row counts alone are insufficient.

## Release boundary

The RC.2 CI gates passing does **not** authorize production rollout. The synthetic runner uses disposable PostgreSQL 16 and does not prove production-shaped data recovery, encrypted off-host backups, production roles/privileges, disaster-recovery cutover, or operational RPO/RTO. Do not upload credentials, connection strings, raw staging dumps, or unredacted business data to GitHub artifacts.
