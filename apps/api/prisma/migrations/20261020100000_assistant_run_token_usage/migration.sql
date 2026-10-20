ALTER TABLE "AssistantRun"
  ADD COLUMN "inputTokens" INTEGER,
  ADD COLUMN "outputTokens" INTEGER,
  ADD COLUMN "totalTokens" INTEGER,
  ADD COLUMN "usageStatus" VARCHAR(20) NOT NULL DEFAULT 'UNAVAILABLE',
  ADD COLUMN "usageCapturedAt" TIMESTAMPTZ(3);

ALTER TABLE "AssistantRun"
  ADD CONSTRAINT "AssistantRun_usageStatus_check"
    CHECK ("usageStatus" IN ('COMPLETE', 'PARTIAL', 'UNAVAILABLE')),
  ADD CONSTRAINT "AssistantRun_token_counts_nonnegative_check"
    CHECK (
      ("inputTokens" IS NULL OR "inputTokens" >= 0)
      AND ("outputTokens" IS NULL OR "outputTokens" >= 0)
      AND ("totalTokens" IS NULL OR "totalTokens" >= 0)
    ),
  ADD CONSTRAINT "AssistantRun_usage_consistency_check"
    CHECK (
      (
        "usageStatus" = 'COMPLETE'
        AND "inputTokens" IS NOT NULL
        AND "outputTokens" IS NOT NULL
        AND "totalTokens" IS NOT NULL
        AND "usageCapturedAt" IS NOT NULL
        AND "totalTokens" = "inputTokens" + "outputTokens"
      )
      OR (
        "usageStatus" IN ('PARTIAL', 'UNAVAILABLE')
        AND "inputTokens" IS NULL
        AND "outputTokens" IS NULL
        AND "totalTokens" IS NULL
        AND "usageCapturedAt" IS NULL
      )
    );

CREATE INDEX "AssistantRun_usageStatus_createdAt_idx"
  ON "AssistantRun"("usageStatus", "createdAt");
