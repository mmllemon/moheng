-- Stage 2: run AFTER 20261013020000 and BEFORE 20261013030000.
\set ON_ERROR_STOP on
SET search_path TO moheng_staging_test;

-- Simulate a stale cached effective total while preserving the baseline captured from the old contractAmount.
UPDATE "Project" SET "contractAmount" = 0.00 WHERE code IN ('STG-01', 'STG-02', 'STG-03');

UPDATE "Change"
SET "direction" = 'INCREASE',
    "externalConfirmedAmount" = 1200000.00,
    "externalConfirmationStatus" = 'EFFECTIVE',
    "externalConfirmedAt" = NOW(),
    "effectiveAt" = NOW()
WHERE id = 'stg-chg-01';

UPDATE "Change"
SET "direction" = 'INCREASE',
    "externalConfirmedAmount" = NULL,
    "externalConfirmationStatus" = 'NOT_CONFIRMED',
    "effectiveAt" = NULL
WHERE id = 'stg-chg-02';

UPDATE "Change"
SET "direction" = 'INCREASE',
    "externalConfirmedAmount" = 300000.00,
    "externalConfirmationStatus" = 'EFFECTIVE',
    "externalConfirmedAt" = NOW(),
    "effectiveAt" = NOW(),
    "deletedAt" = NOW()
WHERE id = 'stg-chg-03';

UPDATE "Change"
SET "direction" = 'DECREASE',
    "externalConfirmedAmount" = 500000.00,
    "externalConfirmationStatus" = 'EFFECTIVE',
    "externalConfirmedAt" = NOW(),
    "effectiveAt" = NOW()
WHERE id = 'stg-chg-04';

UPDATE "Change"
SET "direction" = 'INCREASE',
    "externalConfirmedAmount" = NULL,
    "externalConfirmationStatus" = 'NOT_CONFIRMED',
    "effectiveAt" = NULL
WHERE id = 'stg-chg-05';
