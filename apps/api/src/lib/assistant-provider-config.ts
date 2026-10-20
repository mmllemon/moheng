import { prisma } from './prisma.js';
import { decryptIntegrationSecret, encryptIntegrationSecret, type EncryptedSecret } from './integration-vault.js';
import { isAssistantBaseUrlValid } from './assistant-config.js';

const CONFIG_ID = 'default';
const SECRET_CODE = 'ASSISTANT_PROVIDER';

export type AssistantProviderConfig = {
  configured: boolean;
  enabled: boolean;
  runtimeSource: 'database' | 'environment' | 'none';
  provider: {
    name: string;
    baseUrl: string;
    modelId: string;
    apiKeyConfigured: boolean;
    keyVersion: number;
    lastModelsFetchedAt: string | null;
    lastModelCount: number | null;
    lastTestAt: string | null;
    lastTestStatus: string | null;
    lastTestSummary: string | null;
  };
  configuration: {
    providerConfigured: boolean;
    modelConfigured: boolean;
    checkpointConfigured: boolean;
    checkpointSchemaReady: boolean;
    endpointValid: boolean;
    vaultConfigured: boolean;
  };
  configurationReady: boolean;
};

export type AssistantRuntimeConfig = {
  enabled: boolean;
  apiKey?: string;
  modelId?: string;
  baseUrl?: string;
  checkpointUrl?: string;
  source: 'database' | 'environment' | 'none';
};

function vaultKeyHex(): string | undefined {
  const candidate = process.env.ASSISTANT_ENCRYPTION_KEY?.trim() || process.env.INTEGRATION_ENCRYPTION_KEY?.trim();
  return candidate && /^[a-fA-F0-9]{64}$/.test(candidate) ? candidate : undefined;
}

export function assistantVaultConfigured() {
  return Boolean(vaultKeyHex());
}

export function encryptAssistantProviderKey(secret: string, version: number): EncryptedSecret {
  const key = vaultKeyHex();
  if (!key) throw new Error('ASSISTANT_VAULT_NOT_CONFIGURED');
  return encryptIntegrationSecret(secret, SECRET_CODE, version, key);
}

export function decryptAssistantProviderKey(value: EncryptedSecret, version: number): string {
  const key = vaultKeyHex();
  if (!key) throw new Error('ASSISTANT_VAULT_NOT_CONFIGURED');
  return decryptIntegrationSecret(value, SECRET_CODE, version, key);
}

function envRuntime(): AssistantRuntimeConfig {
  const apiKey = process.env.OPENAI_API_KEY?.trim() || undefined;
  const modelId = process.env.ASSISTANT_POC_MODEL_ID?.trim() || undefined;
  const baseUrl = process.env.OPENAI_BASE_URL?.trim() || undefined;
  const checkpointUrl = process.env.ASSISTANT_CHECKPOINT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || undefined;
  return { enabled: process.env.ASSISTANT_POC_ENABLED === 'true', apiKey, modelId, baseUrl, checkpointUrl, source: apiKey || modelId ? 'environment' : 'none' };
}

export async function loadAssistantRuntimeConfig(): Promise<AssistantRuntimeConfig> {
  const row = await prisma.assistantProviderConfig.findUnique({ where: { id: CONFIG_ID } });
  if (!row) return envRuntime();
  let apiKey: string | undefined;
  if (row.apiKeyCiphertext && row.apiKeyIv && row.apiKeyAuthTag) {
    try {
      apiKey = decryptAssistantProviderKey({ ciphertext: row.apiKeyCiphertext, iv: row.apiKeyIv, authTag: row.apiKeyAuthTag }, row.keyVersion);
    } catch {
      apiKey = undefined;
    }
  }
  return {
    enabled: row.enabled,
    apiKey,
    modelId: row.modelId?.trim() || undefined,
    baseUrl: row.baseUrl?.trim() || undefined,
    checkpointUrl: process.env.ASSISTANT_CHECKPOINT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || undefined,
    source: 'database',
  };
}

export async function isCheckpointSchemaReady(): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'moheng_assistant') AS "exists"`;
    return Boolean(rows[0]?.exists);
  } catch {
    return false;
  }
}

export async function getAssistantRuntimeStatus() {
  const [runtime, checkpointSchemaReady] = await Promise.all([loadAssistantRuntimeConfig(), isCheckpointSchemaReady()]);
  return {
    enabled: runtime.enabled,
    configurationReady: Boolean(runtime.apiKey && runtime.modelId && runtime.checkpointUrl && checkpointSchemaReady && isAssistantBaseUrlValid(runtime.baseUrl)),
    configuration: {
      providerConfigured: Boolean(runtime.apiKey),
      modelConfigured: Boolean(runtime.modelId),
      checkpointConfigured: Boolean(runtime.checkpointUrl),
      checkpointSchemaReady,
      endpointValid: isAssistantBaseUrlValid(runtime.baseUrl),
    },
    source: runtime.source,
  };
}

export function publicAssistantProviderConfig(row: Awaited<ReturnType<typeof prisma.assistantProviderConfig.findUnique>>, checkpointSchemaReady = false): AssistantProviderConfig {
  const env = envRuntime();
  const apiKeyConfigured = Boolean(row?.apiKeyCiphertext) || Boolean(env.apiKey);
  const baseUrl = row?.baseUrl?.trim() || env.baseUrl || '';
  const modelId = row?.modelId?.trim() || env.modelId || '';
  const checkpointConfigured = Boolean(process.env.ASSISTANT_CHECKPOINT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim());
  const endpointValid = isAssistantBaseUrlValid(baseUrl);
  const vaultConfigured = assistantVaultConfigured();
  return {
    configured: Boolean(row),
    enabled: row?.enabled ?? env.enabled,
    runtimeSource: row ? 'database' : (env.apiKey || env.modelId ? 'environment' : 'none'),
    provider: {
      name: row?.name ?? 'OpenAI 兼容供应商',
      baseUrl,
      modelId,
      apiKeyConfigured,
      keyVersion: row?.keyVersion ?? 0,
      lastModelsFetchedAt: row?.lastModelsFetchedAt?.toISOString() ?? null,
      lastModelCount: row?.lastModelCount ?? null,
      lastTestAt: row?.lastTestAt?.toISOString() ?? null,
      lastTestStatus: row?.lastTestStatus ?? null,
      lastTestSummary: row?.lastTestSummary ?? null,
    },
    configuration: {
      providerConfigured: apiKeyConfigured,
      modelConfigured: Boolean(modelId),
      checkpointConfigured,
      checkpointSchemaReady,
      endpointValid,
      vaultConfigured,
    },
    configurationReady: apiKeyConfigured && Boolean(modelId) && checkpointConfigured && checkpointSchemaReady && endpointValid,
  };
}
