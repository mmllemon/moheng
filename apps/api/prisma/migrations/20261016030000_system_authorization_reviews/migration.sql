-- Auditable snapshots for periodic company/project authorization reviews.
CREATE TYPE "AuthorizationReviewStatus" AS ENUM ('PENDING', 'REVIEWED');

CREATE TABLE "SystemAuthorizationReview" (
  "id" TEXT NOT NULL,
  "status" "AuthorizationReviewStatus" NOT NULL DEFAULT 'PENDING',
  "summary" JSONB NOT NULL,
  "snapshot" JSONB NOT NULL,
  "reviewNote" VARCHAR(1000),
  "createdById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMPTZ(3),
  CONSTRAINT "SystemAuthorizationReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SystemAuthorizationReview_review_state_check" CHECK (("status" = 'PENDING' AND "reviewedAt" IS NULL AND "reviewedById" IS NULL) OR ("status" = 'REVIEWED' AND "reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL))
);
CREATE INDEX "SystemAuthorizationReview_status_createdAt_idx" ON "SystemAuthorizationReview"("status", "createdAt");
CREATE INDEX "SystemAuthorizationReview_createdById_createdAt_idx" ON "SystemAuthorizationReview"("createdById", "createdAt");
ALTER TABLE "SystemAuthorizationReview" ADD CONSTRAINT "SystemAuthorizationReview_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SystemAuthorizationReview" ADD CONSTRAINT "SystemAuthorizationReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
