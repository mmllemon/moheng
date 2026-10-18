# Review: staging data migration reconciliation report

Reviewed report commit: `83cb10702efdf0129047feeaee6993a4aa9c8ca8`

Source report: `docs/gates/staging-data-migration-reconciliation.md`

## Conclusion

The report is useful as a record of the claimed isolated-schema rehearsal and it identifies four concrete data-quality questions. However, the repository snapshot does not yet contain a fully reproducible path for that exact rehearsal. Treat the recorded STG-01/STG-02/STG-03 values as report evidence supplied by the run author, not as independently reproduced results, until the fixture sequence below is corrected and rerun from a clean checkout.

This review does **not** allege that the author touched `public`; that cannot be verified from repository contents alone. No database was accessed or changed during this review.

## Reproducibility gaps found in the checked-in tree

1. The report's reproduction commands reference `stage1-legacy.mjs`, `sq.mjs`, and `_v1.sql` / `_v3.sql` / `_v4.sql` / `_v8.sql`. The first two and the four query files were not present in the repository tree at the reviewed commit. The read-only query files are now checked in alongside this review; the local helper scripts are still not part of the repository.
2. `seed-legacy-before-migration.sql` is not valid as a fixture for the schema immediately before `20261013020000_contract_change_external_confirmation`: it references fields introduced by that migration (`originalContractAmount`, `direction`, external-confirmation fields and change actor columns) and also inserts `BusinessParty` records before the migration that creates that table.
3. The same fixture inserts `CostEntry.category` / `CostEntry.occurredOn`, whereas the committed initial migration defines `CostEntry.type` / `CostEntry.date`.
4. That fixture uses `BusinessPartyRole` values such as `CONTRACTOR`; the committed enum instead allows `OWNER`, `MATERIAL_SUPPLIER`, `LABOR_SUBCONTRACTOR`, `PROFESSIONAL_SUBCONTRACTOR`, `EQUIPMENT_LESSOR`, `SERVICE_PROVIDER`, and `OTHER`.
5. The actor-backfill migration only reads matching `AuditLog` events with `action = 'CREATE'` for `createdById`, and `action = 'STATUS_CHANGE'` plus `changes->>'to' = 'SUBMITTED'` for `submittedById`. The staging fixtures currently use `CHANGE_CREATED`, `CHANGE_INTERNAL_APPROVED`, and `CHANGE_EXTERNAL_CONFIRMED`; those actions do not exercise these backfill predicates. Several fixture rows also populate actor columns directly. The separate CI upgrade gate does test `CREATE` / `STATUS_CHANGE` backfill correctly, but that is a different fixture and does not independently prove the STG report's local run.
6. `seed-legacy-before-migration.sql` and `seed-business-parties.sql` both insert the same audit-log IDs (and costs). Running both exactly as the report's command sequence states would conflict on primary keys unless a non-committed helper alters or filters one of the scripts.

The current CI gate at `scripts/rehearse-legacy-data-migration.mjs` remains the reproducible proof for its own `UPGRADE-01` fixture. It should not be represented as an independent reproduction of the report's STG fixture set.

## Classification of the four report findings

| Finding | Current treatment |
|---|---|
| A legacy unverified party and a formal party share the same normalized name | Keep both records until source contracts / credit codes are compared and an approved merge map is recorded. Never merge solely by normalized name. |
| `STG02-BG-0002` has no actor fields and no audit events | Keep the attribution unresolved. Do not infer or auto-fill a person; record a manual exception until primary evidence exists. |
| `approvedAmount = 1,500,000` and `externalConfirmedAmount = 1,200,000` differ by 300,000 | This difference must remain visible for follow-up, but the effective-contract calculation follows the already selected rule: externally confirmed amount is the adjustment basis. Do not substitute internal approved amount into the effective contract total. |
| Projects point to unverified legacy parties instead of formal party records | Conservative behaviour. Match by verified registration/credit code and source contract before updating any relationship; an alias/name-only match is not enough. |

## Read-only inspection queries

The missing query files named by the report are now committed in this folder:

- `_v1.sql`: project/main-contract amount and recomputed effective amount.
- `_v3.sql`: reconciliation journal, including before/after values and reason codes.
- `_v4.sql`: change actor fields and matching audit-event counts.
- `_v8.sql`: normalized-name duplicates and auto-created unverified parties.

They target only `moheng_staging_test` using session-level `search_path` and contain SELECT statements only. Do not run fixture seeding or schema reset commands against any non-disposable database.

## Gate required before treating this report as release evidence

- [ ] Commit a self-contained runner and staged fixtures that apply the true historical migration prefixes in order; keep old-schema seed columns limited to the fields that existed at that migration point.
- [ ] From a clean checkout, run the runner against an explicitly isolated loopback PostgreSQL schema and archive the exact commit SHA, command log, schema name, migration checksums, row counts, reconciliation rows and query outputs.
- [ ] Capture before/after fingerprints for the protected `public` schema (not counts alone) if the assertion is that it was untouched.
- [ ] Obtain a reviewer-approved reconciliation of the party duplicate and missing actor, or preserve them as explicit unresolved exceptions.
- [ ] Keep the 300,000 internal/external amount discrepancy visible in the exception report; the effective amount remains based on external confirmation under the chosen business rule.

No production or user staging data should be modified as part of this review.
