export interface AssistantRuntimeConfigurationStatus {
  enabled: boolean;
  configurationReady: boolean;
  configuration: {
    providerConfigured: boolean;
    modelConfigured: boolean;
    checkpointConfigured: boolean;
    endpointValid: boolean;
  };
}

export function isAssistantBaseUrlValid(raw: string | undefined): boolean {
  const value = raw?.trim();
  if (!value) return true;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && Boolean(url.hostname)
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

/**
 * Return readiness booleans only. Never echo model secrets, raw model IDs, URLs,
 * or database connection strings to the browser.
 */
export function getAssistantRuntimeConfigurationStatus(
  env: Record<string, string | undefined> = process.env,
): AssistantRuntimeConfigurationStatus {
  const providerConfigured = Boolean(env.OPENAI_API_KEY?.trim());
  const modelConfigured = Boolean(env.ASSISTANT_POC_MODEL_ID?.trim());
  const checkpointConfigured = Boolean(
    env.ASSISTANT_CHECKPOINT_DATABASE_URL?.trim() || env.DATABASE_URL?.trim(),
  );
  const endpointValid = isAssistantBaseUrlValid(env.OPENAI_BASE_URL);
  return {
    enabled: env.ASSISTANT_POC_ENABLED === 'true',
    configurationReady: providerConfigured && modelConfigured && checkpointConfigured && endpointValid,
    configuration: {
      providerConfigured,
      modelConfigured,
      checkpointConfigured,
      endpointValid,
    },
  };
}
