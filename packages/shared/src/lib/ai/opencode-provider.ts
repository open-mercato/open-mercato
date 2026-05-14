type EnvLookup = Record<string, string | undefined>

export type OpenCodeProviderId = 'anthropic' | 'openai' | 'google'

export type OpenCodeProviderDefinition = {
  id: OpenCodeProviderId
  name: string
  envKeys: readonly string[]
  defaultModel: string
}

export const OPEN_CODE_PROVIDER_IDS = ['anthropic', 'openai', 'google'] as const

/**
 * Default provider id used by the unified AI framework when neither
 * `OM_AI_PROVIDER` nor the legacy `OPENCODE_PROVIDER` is set. The default
 * targets OpenAI + `gpt-5-mini` (see {@link OPEN_CODE_PROVIDERS.openai}).
 */
export const DEFAULT_AI_PROVIDER_ID: OpenCodeProviderId = 'openai'

export const OPEN_CODE_PROVIDERS: Record<OpenCodeProviderId, OpenCodeProviderDefinition> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    envKeys: ['ANTHROPIC_API_KEY', 'OPENCODE_ANTHROPIC_API_KEY'],
    defaultModel: 'claude-haiku-4-5-20251001',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    envKeys: ['OPENAI_API_KEY', 'OPENCODE_OPENAI_API_KEY'],
    defaultModel: 'gpt-5-mini',
  },
  google: {
    id: 'google',
    name: 'Google',
    envKeys: ['GOOGLE_GENERATIVE_AI_API_KEY', 'OPENCODE_GOOGLE_API_KEY'],
    defaultModel: 'gemini-3-flash',
  },
}

export type OpenCodeModelResolution = {
  modelId: string
  modelWithProvider: string
  source: 'override' | 'om_ai_model' | 'opencode_model' | 'default'
}

/**
 * Resolves the requested AI provider id from the unified env vars.
 *
 * Precedence (highest first):
 *   1. `OM_AI_PROVIDER` — new canonical variable for the unified AI module.
 *   2. `OPENCODE_PROVIDER` — legacy variable, kept for backward compatibility.
 *   3. {@link DEFAULT_AI_PROVIDER_ID} (currently `openai`).
 *
 * Unknown / empty values fall through to the next tier so a typo in
 * `OM_AI_PROVIDER` does not silently disable the legacy fallback.
 */
export function resolveAiProviderIdFromEnv(
  env: EnvLookup = process.env,
  fallback: OpenCodeProviderId = DEFAULT_AI_PROVIDER_ID,
): OpenCodeProviderId {
  const candidates = [env.OM_AI_PROVIDER, env.OPENCODE_PROVIDER]
  for (const candidate of candidates) {
    const normalized = normalizeToken(candidate)?.toLowerCase()
    if (normalized && isOpenCodeProviderId(normalized)) {
      return normalized
    }
  }
  return fallback
}

function normalizeToken(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function parseModelToken(token: string): { providerPrefix: string | null; modelId: string } {
  const slashIndex = token.indexOf('/')
  if (slashIndex <= 0) {
    return {
      providerPrefix: null,
      modelId: token,
    }
  }

  return {
    providerPrefix: token.slice(0, slashIndex).trim().toLowerCase(),
    modelId: token.slice(slashIndex + 1).trim(),
  }
}

export function isOpenCodeProviderId(value: string): value is OpenCodeProviderId {
  return (OPEN_CODE_PROVIDER_IDS as readonly string[]).includes(value)
}

export function resolveOpenCodeProviderId(
  providerId: string | null | undefined,
  fallback: OpenCodeProviderId = 'anthropic',
): OpenCodeProviderId {
  const normalized = normalizeToken(providerId)?.toLowerCase()
  if (normalized && isOpenCodeProviderId(normalized)) {
    return normalized
  }

  return fallback
}

export function resolveFirstConfiguredOpenCodeProvider(
  options?: {
    env?: EnvLookup
    order?: readonly OpenCodeProviderId[]
  },
): OpenCodeProviderId | null {
  const env = options?.env ?? process.env
  const order = options?.order ?? OPEN_CODE_PROVIDER_IDS

  for (const providerId of order) {
    if (isOpenCodeProviderConfigured(providerId, env)) {
      return providerId
    }
  }

  return null
}

export function resolveOpenCodeProviderApiKey(
  providerId: OpenCodeProviderId,
  env: EnvLookup = process.env,
): string | null {
  const provider = OPEN_CODE_PROVIDERS[providerId]
  for (const key of provider.envKeys) {
    const value = normalizeToken(env[key])
    if (value) {
      return value
    }
  }

  return null
}

export function requireOpenCodeProviderApiKey(
  providerId: OpenCodeProviderId,
  env: EnvLookup = process.env,
): string {
  const apiKey = resolveOpenCodeProviderApiKey(providerId, env)
  if (apiKey) {
    return apiKey
  }

  const provider = OPEN_CODE_PROVIDERS[providerId]
  const envKeysHint = provider.envKeys.join(' or ')
  throw new Error(
    `Missing API key for provider "${providerId}". Set ${envKeysHint} in your .env file.`,
  )
}

export function getOpenCodeProviderConfiguredEnvKey(
  providerId: OpenCodeProviderId,
  env: EnvLookup = process.env,
): string {
  const provider = OPEN_CODE_PROVIDERS[providerId]
  for (const key of provider.envKeys) {
    if (normalizeToken(env[key])) {
      return key
    }
  }

  return provider.envKeys[0]
}

export function isOpenCodeProviderConfigured(
  providerId: OpenCodeProviderId,
  env: EnvLookup = process.env,
): boolean {
  return resolveOpenCodeProviderApiKey(providerId, env) !== null
}

export function resolveOpenCodeModel(
  providerId: OpenCodeProviderId,
  options?: {
    overrideModel?: string | null | undefined
    env?: EnvLookup
  },
): OpenCodeModelResolution {
  const env = options?.env ?? process.env
  const overrideModel = normalizeToken(options?.overrideModel)
  const omAiModel = normalizeToken(env.OM_AI_MODEL)
  const opencodeModel = normalizeToken(env.OPENCODE_MODEL)

  let source: OpenCodeModelResolution['source'] = 'default'
  let selectedModel = OPEN_CODE_PROVIDERS[providerId].defaultModel

  if (opencodeModel) {
    selectedModel = opencodeModel
    source = 'opencode_model'
  }

  if (omAiModel) {
    selectedModel = omAiModel
    source = 'om_ai_model'
  }

  if (overrideModel) {
    selectedModel = overrideModel
    source = 'override'
  }

  const parsed = parseModelToken(selectedModel)
  if (parsed.providerPrefix && parsed.providerPrefix !== providerId) {
    throw new Error(
      `Model "${selectedModel}" does not match configured provider "${providerId}"`,
    )
  }

  const modelId = normalizeToken(parsed.modelId)
  if (!modelId) {
    throw new Error(`Model "${selectedModel}" is invalid`)
  }

  return {
    modelId,
    modelWithProvider: `${providerId}/${modelId}`,
    source,
  }
}
