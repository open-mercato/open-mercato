/**
 * Env-driven provider/model allowlist (Phase 1780-5).
 *
 * Two env variables govern which AI providers/models the runtime accepts. They
 * are the ULTIMATE constraint — settings UI, per-tenant overrides, per-agent
 * defaults, and request-time overrides are all clipped against this list. When
 * a caller asks for a provider/model outside the allowlist the runtime emits a
 * warning and falls back to the agent's default (or to the first allowlisted
 * pair when even the default is rejected).
 *
 * - `OM_AI_AVAILABLE_PROVIDERS=openai,anthropic`
 *     Comma-separated provider ids. Unset/empty → no provider restriction.
 *     Whitespace-tolerant; case-insensitive comparison against the registry.
 *
 * - `OM_AI_AVAILABLE_MODELS_<PROVIDER>=gpt-5-mini,gpt-5`
 *     Per-provider comma-separated model id list. Unset/empty → no model
 *     restriction for that provider. PROVIDER is uppercased from the registry
 *     id (e.g. `openai` → `OM_AI_AVAILABLE_MODELS_OPENAI`).
 *
 * Both vars are read fresh on every call so hot-reload and test overrides
 * work without re-creating the factory.
 */

export type EnvLookup = Record<string, string | undefined>

const PROVIDERS_ENV = 'OM_AI_AVAILABLE_PROVIDERS'

function envProvidersVarName(): string {
  return PROVIDERS_ENV
}

function envModelsVarName(providerId: string): string {
  return `OM_AI_AVAILABLE_MODELS_${providerId.toUpperCase()}`
}

function parseList(raw: string | undefined): string[] | null {
  if (raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  const items = trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return items.length > 0 ? items : null
}

/**
 * Reads the configured provider allowlist. Returns `null` when the env var is
 * unset or empty (no restriction). Otherwise returns the parsed list of
 * provider ids (preserving caller order; case preserved as-written).
 */
export function readAllowedProviders(env: EnvLookup = process.env): string[] | null {
  return parseList(env[PROVIDERS_ENV])
}

/**
 * Reads the configured per-provider model allowlist. Returns `null` when the
 * env var is unset or empty (no restriction for that provider). Otherwise
 * returns the parsed model id list.
 */
export function readAllowedModels(
  env: EnvLookup,
  providerId: string,
): string[] | null {
  return parseList(env[envModelsVarName(providerId)])
}

/**
 * Snapshot of the env-driven allowlist suitable for the settings GET response.
 * `hasRestrictions` is `true` when at least one of the env vars is set.
 */
export interface AllowlistConfig {
  providers: string[] | null
  modelsByProvider: Record<string, string[]>
  hasRestrictions: boolean
}

/**
 * Reads the full allowlist for every provider in `knownProviderIds` and
 * returns a snapshot. Use the settings response to feed UI dropdowns so the
 * picker can only offer values the runtime would accept.
 */
export function readAllowlistConfig(
  env: EnvLookup = process.env,
  knownProviderIds: string[] = [],
): AllowlistConfig {
  const providers = readAllowedProviders(env)
  const modelsByProvider: Record<string, string[]> = {}
  for (const providerId of knownProviderIds) {
    const list = readAllowedModels(env, providerId)
    if (list !== null) modelsByProvider[providerId] = list
  }
  return {
    providers,
    modelsByProvider,
    hasRestrictions: providers !== null || Object.keys(modelsByProvider).length > 0,
  }
}

/**
 * Returns `true` when the provider is permitted by the allowlist (or when no
 * provider restriction is configured). Case-insensitive id comparison.
 */
export function isProviderAllowed(
  env: EnvLookup,
  providerId: string,
): boolean {
  const allowed = readAllowedProviders(env)
  if (allowed === null) return true
  const needle = providerId.toLowerCase()
  return allowed.some((id) => id.toLowerCase() === needle)
}

/**
 * Returns `true` when the model is permitted for the provider by the
 * allowlist (or when no per-provider model restriction is configured).
 * Case-sensitive model id comparison — model ids are vendor-specified strings
 * (e.g. `gpt-5-mini`, `claude-opus-4-20250514`).
 */
export function isModelAllowedForProvider(
  env: EnvLookup,
  providerId: string,
  modelId: string,
): boolean {
  const allowed = readAllowedModels(env, providerId)
  if (allowed === null) return true
  return allowed.includes(modelId)
}

/**
 * Returns `true` when the (provider, model) pair satisfies BOTH the provider
 * allowlist and the per-provider model allowlist. Convenience helper for
 * settings PUT validators.
 */
export function isProviderModelAllowed(
  env: EnvLookup,
  providerId: string,
  modelId: string,
): boolean {
  return isProviderAllowed(env, providerId) && isModelAllowedForProvider(env, providerId, modelId)
}

/**
 * Public version of {@link envModelsVarName} for docs/UI hints.
 */
export function modelAllowlistEnvVarName(providerId: string): string {
  return envModelsVarName(providerId)
}

/**
 * Public version of {@link envProvidersVarName}.
 */
export function providerAllowlistEnvVarName(): string {
  return envProvidersVarName()
}
