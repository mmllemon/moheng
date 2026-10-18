# Prisma 7 RC.2 — populated legacy-data migration-upgrade rehearsal

## Purpose

Exercise high-risk data backfills with rows already present before the relevant migrations. The gate uses a separate disposable PostgreSQL 16 service in GitHub Actions. It never connects to staging or production. It supplements, but does not replace, a rehearsal on a sanitized representative staging snapshot.

## Three-stage upgrade

1. Apply migrations through `20261013020000_contract_change_external_confirmation`, then insert legacy-shaped project, main-contract, change, and audit-log rows.
2. Apply migrations through `20261014010000_settlement_payables_invoice_retention`, then insert a downstream supplier contract plus linked and unlinked cost entries.
3. Deploy all remaining committed migrations, including contract-baseline reconciliation and business-party backfills; then assert the resulting business values and traceability.

The gate copies each historical migration directory byte-for-byte into temporary prefix directories, preserving real migration names and checksums. A temporary Prisma config points at each prefix, then the normal full migration directory is used for the final phase.

## Mechanical acceptance criteria

- The safety guard allows only `127.0.0.1:5432/moheng_upgrade_test` with the disposable CI `postgres` role.
- Project UPGRADE-01 begins with a legacy `contractAmount` of 12,580,000.00 and a signed main contract of 12,000,000.00.
- An externally effective +500,000.00 change and effective -100,000.00 change yield original contract amount 12,000,000.00 and current effective contract amount 12,400,000.00.
- A pending +250,000.00 change and a soft-deleted effective change do not contribute to the effective amount.
- `ContractBaselineMigrationReconciliation` preserves previous and reconciled values with a reason code.
- Historical change creator and submitter are reconstructed separately from CREATE and STATUS_CHANGE audit events.
- Normalized owner names link consistently; a distinct legal-name string remains separate. Free-text backfilled identities remain `identityVerified=false`.
- A cost linked to a downstream contract inherits the contract's counterparty identity even when its old free-text vendor differs; an unlinked cost with a normalized spelling resolves to the same unverified party.
- All committed migrations complete on the populated legacy-shaped database.
- A non-sensitive report is published at `.assistant-gate-artifacts/legacy-migration-upgrade.txt`.

## Risk boundary

This gate runs data backfills after legacy-shaped rows exist, unlike the clean-database migration gate. The values are synthetic and the baseline is staged from migration prefixes, not copied from a real historical installation. It cannot validate actual project-level outliers, name-collision frequency, undocumented manual corrections, production database scale/locks, or downtime.

Before release, run the review on a sanitized representative staging snapshot. Export every row from `ContractBaselineMigrationReconciliation`; reconcile per-project amounts against signed main contracts and effective external confirmations; sample BusinessParty matches against credit codes and source documents; resolve missing or ambiguous historical change actors; and record row counts, before/after amounts, exceptions, checksums, recovery time, data-loss window, and responsible reviewers. Do not infer production approval from a CI PASS.
