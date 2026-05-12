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
  const envSafeProviderId = providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')
  return `OM_AI_AVAILABLE_MODELS_${envSafeProviderId}`
}

function envSafeId(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}

function agentOverrideProvidersVarName(agentId: string): string {
  return `OM_AI_AGENT_${envSafeId(agentId)}_AVAILABLE_PROVIDERS`
}

function agentOverrideModelsVarName(agentId: string, providerId: string): string {
  return `OM_AI_AGENT_${envSafeId(agentId)}_AVAILABLE_MODELS_${envSafeId(providerId)}`
}

export function normalizeProviderId(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-')
}

export function providerIdAliases(providerId: string): string[] {
  const normalized = normalizeProviderId(providerId)
  if (!normalized) return []
  return Array.from(new Set([normalized, normalized.replace(/-/g, '_')]))
}

export function canonicalProviderId(
  providerId: string,
  knownProviderIds: readonly string[],
): string | null {
  const normalized = normalizeProviderId(providerId)
  return knownProviderIds.find((id) => normalizeProviderId(id) === normalized) ?? null
}

function canonicalizeProviderList(
  providerIds: string[] | null,
  knownProviderIds: readonly string[],
): string[] | null {
  if (providerIds === null) return null
  const result: string[] = []
  const seen = new Set<string>()
  for (const providerId of providerIds) {
    const canonical = canonicalProviderId(providerId, knownProviderIds) ?? normalizeProviderId(providerId)
    const key = normalizeProviderId(canonical)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(canonical)
  }
  return result
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
  const needle = normalizeProviderId(providerId)
  return allowed.some((id) => normalizeProviderId(id) === needle)
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

export function agentOverrideProviderAllowlistEnvVarName(agentId: string): string {
  return agentOverrideProvidersVarName(agentId)
}

export function agentOverrideModelAllowlistEnvVarName(
  agentId: string,
  providerId: string,
): string {
  return agentOverrideModelsVarName(agentId, providerId)
}

/**
 * Tenant-scoped allowlist snapshot (Phase 1780-6). Persisted by the
 * `ai_tenant_model_allowlists` table and edited from the AI assistant
 * settings page. The runtime intersects this with the env allowlist before
 * picking which provider/model is permitted.
 *
 * `allowedProviders === null` means "inherit env" (no tenant-level provider
 * restriction). For `allowedModelsByProvider`, a missing key means "inherit
 * env" for that provider; an empty array means "no models permitted for this
 * provider" — the runtime will refuse all picks for that provider.
 */
export interface TenantAllowlistSnapshot {
  allowedProviders: string[] | null
  allowedModelsByProvider: Record<string, string[]>
}

export function hasAllowlistSnapshotRestrictions(snapshot: TenantAllowlistSnapshot | null): boolean {
  return Boolean(
    snapshot &&
      (snapshot.allowedProviders !== null ||
        Object.keys(snapshot.allowedModelsByProvider ?? {}).length > 0),
  )
}

export function readAgentRuntimeOverrideAllowlist(
  env: EnvLookup,
  agentId: string,
  knownProviderIds: string[],
): TenantAllowlistSnapshot | null {
  const providers = parseList(env[agentOverrideProvidersVarName(agentId)])
  const modelsByProvider: Record<string, string[]> = {}
  for (const providerId of knownProviderIds) {
    const list = parseList(env[agentOverrideModelsVarName(agentId, providerId)])
    if (list !== null) modelsByProvider[providerId] = list
  }
  const snapshot = {
    allowedProviders: providers,
    allowedModelsByProvider: modelsByProvider,
  }
  return hasAllowlistSnapshotRestrictions(snapshot) ? snapshot : null
}

/**
 * Effective allowlist after intersecting env with tenant. Both axes are
 * `null` when neither side imposes a restriction — semantically equivalent to
 * `readAllowlistConfig` with no tenant snapshot.
 */
export interface EffectiveAllowlist {
  providers: string[] | null
  modelsByProvider: Record<string, string[]>
  hasRestrictions: boolean
  /**
   * `true` when the tenant snapshot contributes any narrowing on top of the
   * env allowlist. Useful for telling the UI "this tenant has its own picks"
   * vs "we are showing env-only restrictions".
   */
  tenantOverridesActive: boolean
}

function intersectIdLists(
  outer: string[] | null,
  inner: string[] | null,
  caseInsensitive: boolean,
): string[] | null {
  if (outer === null && inner === null) return null
  if (outer === null) return inner
  if (inner === null) return outer
  const outerSet = new Set(
    caseInsensitive ? outer.map((id) => normalizeProviderId(id)) : outer,
  )
  const result: string[] = []
  for (const id of inner) {
    const needle = caseInsensitive ? normalizeProviderId(id) : id
    if (outerSet.has(needle)) result.push(id)
  }
  return result
}

/**
 * Intersects the env-driven allowlist with an optional tenant snapshot. The
 * tenant allowlist may NEVER widen the env allowlist; values outside the env
 * are silently dropped. Returns the effective shape the settings UI and
 * model-factory should clip against.
 */
export function intersectAllowlists(
  env: EnvLookup,
  knownProviderIds: string[],
  tenant: TenantAllowlistSnapshot | null,
): EffectiveAllowlist {
  const envProviders = canonicalizeProviderList(readAllowedProviders(env), knownProviderIds)
  const envModelsByProvider: Record<string, string[]> = {}
  for (const providerId of knownProviderIds) {
    const list = readAllowedModels(env, providerId)
    if (list !== null) envModelsByProvider[providerId] = list
  }

  const tenantProviders = canonicalizeProviderList(tenant?.allowedProviders ?? null, knownProviderIds)
  const tenantModelsByProvider = tenant?.allowedModelsByProvider ?? {}

  const providers = intersectIdLists(envProviders, tenantProviders, true)

  const modelsByProvider: Record<string, string[]> = { ...envModelsByProvider }
  for (const rawProviderId of Object.keys(tenantModelsByProvider)) {
    const providerId = canonicalProviderId(rawProviderId, knownProviderIds) ?? normalizeProviderId(rawProviderId)
    const tenantList = tenantModelsByProvider[rawProviderId] ?? []
    const envList = modelsByProvider[providerId] ?? null
    const intersection = intersectIdLists(envList, tenantList, false)
    if (intersection !== null) {
      modelsByProvider[providerId] = intersection
    }
  }

  const tenantOverridesActive =
    tenantProviders !== null || Object.keys(tenantModelsByProvider).length > 0

  return {
    providers,
    modelsByProvider,
    hasRestrictions:
      providers !== null || Object.keys(modelsByProvider).length > 0,
    tenantOverridesActive,
  }
}

export function intersectEffectiveAllowlistWithSnapshot(
  outer: EffectiveAllowlist,
  knownProviderIds: string[],
  inner: TenantAllowlistSnapshot | null,
): EffectiveAllowlist {
  if (!hasAllowlistSnapshotRestrictions(inner)) return outer

  const innerProviders = canonicalizeProviderList(inner?.allowedProviders ?? null, knownProviderIds)
  const providers = intersectIdLists(outer.providers, innerProviders, true)

  const modelsByProvider: Record<string, string[]> = { ...outer.modelsByProvider }
  for (const rawProviderId of Object.keys(inner?.allowedModelsByProvider ?? {})) {
    const providerId = canonicalProviderId(rawProviderId, knownProviderIds) ?? normalizeProviderId(rawProviderId)
    const innerList = inner?.allowedModelsByProvider[rawProviderId] ?? []
    const outerList = modelsByProvider[providerId] ?? null
    const intersection = intersectIdLists(outerList, innerList, false)
    if (intersection !== null) {
      modelsByProvider[providerId] = intersection
    }
  }

  return {
    providers,
    modelsByProvider,
    hasRestrictions: true,
    tenantOverridesActive: outer.tenantOverridesActive || hasAllowlistSnapshotRestrictions(inner),
  }
}

/**
 * Effective-allowlist version of `isProviderAllowed`.
 */
export function isProviderAllowedInEffective(
  effective: EffectiveAllowlist,
  providerId: string,
): boolean {
  if (effective.providers === null) return true
  const needle = normalizeProviderId(providerId)
  return effective.providers.some((id) => normalizeProviderId(id) === needle)
}

/**
 * Effective-allowlist version of `isModelAllowedForProvider`.
 */
export function isModelAllowedForProviderInEffective(
  effective: EffectiveAllowlist,
  providerId: string,
  modelId: string,
): boolean {
  const list = effective.modelsByProvider[providerId] ?? effective.modelsByProvider[normalizeProviderId(providerId)]
  if (list === undefined) return true
  return list.includes(modelId)
}

/**
 * Returns `true` when the (provider, model) pair satisfies the effective
 * allowlist (both env and tenant constraints).
 */
export function isProviderModelAllowedInEffective(
  effective: EffectiveAllowlist,
  providerId: string,
  modelId: string,
): boolean {
  return (
    isProviderAllowedInEffective(effective, providerId) &&
    isModelAllowedForProviderInEffective(effective, providerId, modelId)
  )
}
