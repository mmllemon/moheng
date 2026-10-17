-- Explicit account-level project data scope. Existing accounts stay limited to assigned projects.
CREATE TYPE "UserProjectDataScope" AS ENUM ('ASSIGNED_PROJECTS', 'ALL_PROJECTS_READONLY');
ALTER TABLE "User" ADD COLUMN "dataScope" "UserProjectDataScope" NOT NULL DEFAULT 'ASSIGNED_PROJECTS';
CREATE INDEX "User_dataScope_role_isActive_idx" ON "User"("dataScope", "role", "isActive");
