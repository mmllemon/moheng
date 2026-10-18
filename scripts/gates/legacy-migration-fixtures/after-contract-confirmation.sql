BEGIN;

-- Populate fields introduced by 20261013020000 only after its historical actor backfill has run.
UPDATE "Change"
SET "direction" = 'INCREASE', "externalConfirmedAmount" = 500000.00,
    "externalConfirmationStatus" = 'EFFECTIVE', "externalConfirmedAt" = CURRENT_TIMESTAMP,
    "effectiveAt" = CURRENT_TIMESTAMP, "deletedAt" = NULL
WHERE "id" = 'upgrade-change-increase';

UPDATE "Change"
SET "direction" = 'DECREASE', "externalConfirmedAmount" = 100000.00,
    "externalConfirmationStatus" = 'EFFECTIVE', "externalConfirmedAt" = CURRENT_TIMESTAMP,
    "effectiveAt" = CURRENT_TIMESTAMP, "deletedAt" = NULL
WHERE "id" = 'upgrade-change-decrease';

UPDATE "Change"
SET "direction" = 'INCREASE', "externalConfirmedAmount" = 250000.00,
    "externalConfirmationStatus" = 'PENDING_SUPPLEMENT', "externalConfirmedAt" = CURRENT_TIMESTAMP,
    "effectiveAt" = NULL, "deletedAt" = NULL
WHERE "id" = 'upgrade-change-pending';

UPDATE "Change"
SET "direction" = 'INCREASE', "externalConfirmedAmount" = 999000.00,
    "externalConfirmationStatus" = 'EFFECTIVE', "externalConfirmedAt" = CURRENT_TIMESTAMP,
    "effectiveAt" = CURRENT_TIMESTAMP, "deletedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'upgrade-change-deleted';

COMMIT;
