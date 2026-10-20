-- UI-managed assistant provider configuration (singleton row).
CREATE TABLE "AssistantProviderConfig" (
    "id" VARCHAR(40) NOT NULL DEFAULT 'default',
    "name" VARCHAR(120) NOT NULL DEFAULT 'OpenAI 兼容供应商',
    "baseUrl" VARCHAR(1000),
    "modelId" VARCHAR(200),
    "apiKeyCiphertext" TEXT,
    "apiKeyIv" VARCHAR(32),
    "apiKeyAuthTag" VARCHAR(32),
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastModelsFetchedAt" TIMESTAMPTZ(3),
    "lastModelCount" INTEGER,
    "lastTestAt" TIMESTAMPTZ(3),
    "lastTestStatus" VARCHAR(40),
    "lastTestSummary" VARCHAR(500),
    "updatedById" VARCHAR(100),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "AssistantProviderConfig_pkey" PRIMARY KEY ("id")
);
