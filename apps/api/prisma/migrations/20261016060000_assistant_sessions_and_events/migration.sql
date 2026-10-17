CREATE TABLE "AssistantConversation" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "lastMessageAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AssistantConversation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssistantConversation_status_check" CHECK ("status" IN ('ACTIVE', 'ARCHIVED'))
);
CREATE INDEX "AssistantConversation_ownerUserId_lastMessageAt_idx" ON "AssistantConversation"("ownerUserId", "lastMessageAt");
CREATE INDEX "AssistantConversation_ownerUserId_projectId_lastMessageAt_idx" ON "AssistantConversation"("ownerUserId", "projectId", "lastMessageAt");
CREATE INDEX "AssistantConversation_projectId_status_lastMessageAt_idx" ON "AssistantConversation"("projectId", "status", "lastMessageAt");
ALTER TABLE "AssistantConversation" ADD CONSTRAINT "AssistantConversation_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssistantConversation" ADD CONSTRAINT "AssistantConversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AssistantMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "requestId" VARCHAR(100),
  "role" VARCHAR(20) NOT NULL,
  "content" TEXT NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssistantMessage_role_check" CHECK ("role" IN ('USER', 'ASSISTANT')),
  CONSTRAINT "AssistantMessage_status_check" CHECK ("status" IN ('COMPLETED', 'PENDING', 'FAILED'))
);
CREATE UNIQUE INDEX "AssistantMessage_conversationId_requestId_key" ON "AssistantMessage"("conversationId", "requestId");
CREATE INDEX "AssistantMessage_conversationId_createdAt_idx" ON "AssistantMessage"("conversationId", "createdAt");
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AssistantRun" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "requestId" VARCHAR(100) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "jobId" VARCHAR(100),
  "status" VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
  "cancelRequestedAt" TIMESTAMPTZ(3),
  "lastEventSequence" INTEGER NOT NULL DEFAULT 0,
  "errorCode" VARCHAR(100),
  "startedAt" TIMESTAMPTZ(3),
  "finishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AssistantRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssistantRun_status_check" CHECK ("status" IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'))
);
CREATE UNIQUE INDEX "AssistantRun_jobId_key" ON "AssistantRun"("jobId");
CREATE UNIQUE INDEX "AssistantRun_ownerUserId_conversationId_requestId_key" ON "AssistantRun"("ownerUserId", "conversationId", "requestId");
CREATE INDEX "AssistantRun_conversationId_status_createdAt_idx" ON "AssistantRun"("conversationId", "status", "createdAt");
CREATE INDEX "AssistantRun_ownerUserId_status_createdAt_idx" ON "AssistantRun"("ownerUserId", "status", "createdAt");
CREATE INDEX "AssistantRun_projectId_status_createdAt_idx" ON "AssistantRun"("projectId", "status", "createdAt");
ALTER TABLE "AssistantRun" ADD CONSTRAINT "AssistantRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantRun" ADD CONSTRAINT "AssistantRun_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssistantRun" ADD CONSTRAINT "AssistantRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AssistantRunEvent" (
  "id" SERIAL NOT NULL,
  "conversationId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" VARCHAR(80) NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantRunEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AssistantRunEvent_runId_sequence_key" ON "AssistantRunEvent"("runId", "sequence");
CREATE INDEX "AssistantRunEvent_conversationId_id_idx" ON "AssistantRunEvent"("conversationId", "id");
CREATE INDEX "AssistantRunEvent_runId_sequence_idx" ON "AssistantRunEvent"("runId", "sequence");
ALTER TABLE "AssistantRunEvent" ADD CONSTRAINT "AssistantRunEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantRunEvent" ADD CONSTRAINT "AssistantRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AssistantRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
