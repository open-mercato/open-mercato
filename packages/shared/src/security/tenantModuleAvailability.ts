/**
 * Per-tenant module availability.
 *
 * Modules are enabled per deployment in `modules.ts`. An app can additionally
 * register a `TenantModuleAvailabilityProvider` under
 * `TENANT_MODULE_AVAILABILITY_PROVIDER_DI_KEY` to make some modules unavailable
 * to some tenants (for example modules outside a tenant's subscription plan,
 * or modules that only apply to some kinds of tenant). The realm RBAC services
 * pass the resulting set into the feature policy, which denies the features
 * of those modules for every realm-service check evaluated in that tenant.
 * This is feature-guard enforcement, not data isolation: the modules' own
 * subscribers, workers and read-side snapshot consumers keep running.
 *
 * The provider is only consulted for the module ids it declares in
 * `governedModuleIds`. A failing or slow provider fails closed for those
 * modules only.
 *
 * @see .ai/specs/2026-10-05-tenant-module-availability.md
 */

import { runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import { createLogger } from '../lib/logger'
import { getTelemetryRuntime } from '../lib/telemetry/runtime'

export const TENANT_MODULE_AVAILABILITY_PROVIDER_DI_KEY = 'tenantModuleAvailabilityProvider'
export const TENANT_MODULE_AVAILABILITY_DI_KEY = 'tenantModuleAvailability'

export type TenantModuleAvailabilityContext = {
  tenantId: string
}

export type TenantModuleAvailabilityProvider = {
  /** Module ids this provider decides. Every other module is always available and never waits on the provider. */
  readonly governedModuleIds: readonly string[]
  /** Governed module ids unavailable to the tenant. Ids outside `governedModuleIds` are ignored. */
  getUnavailableModuleIds(
    context: TenantModuleAvailabilityContext,
  ): Promise<readonly string[]> | readonly string[]
  /** Cache TTL for one tenant's answer in milliseconds (default 60 000, at most 600 000). */
  readonly cacheTtlMs?: number
  /** Provider call timeout in milliseconds (default 2 000, at most 30 000). */
  readonly timeoutMs?: number
}

export type TenantModuleAvailability = {
  getUnavailableModuleIds(context: TenantModuleAvailabilityContext): Promise<ReadonlySet<string>>
  isModuleAvailable(moduleId: string, context: TenantModuleAvailabilityContext): Promise<boolean>
  invalidate(tenantId: string): Promise<void>
}

export type TenantModuleAvailabilityCache = Pick<CacheStrategy, 'get' | 'set' | 'delete' | 'deleteByTags'>

export type CreateTenantModuleAvailabilityOptions = {
  provider: TenantModuleAvailabilityProvider
  cache?: TenantModuleAvailabilityCache | null
  /** How long an in-process failure answer is reused before the provider is retried (default 5 000). */
  failureRetryMs?: number
}

export type TenantModuleAvailabilityContainer = {
  hasRegistration(name: string): boolean
  resolve<T>(name: string): T
}

export const DEFAULT_TENANT_MODULE_AVAILABILITY_TTL_MS = 60_000
export const MAX_TENANT_MODULE_AVAILABILITY_TTL_MS = 600_000
export const DEFAULT_TENANT_MODULE_AVAILABILITY_TIMEOUT_MS = 2_000
export const MAX_TENANT_MODULE_AVAILABILITY_TIMEOUT_MS = 30_000
export const DEFAULT_TENANT_MODULE_AVAILABILITY_FAILURE_RETRY_MS = 5_000
export const MAX_TRACKED_TENANT_MODULE_AVAILABILITY_STATES = 10_000

const CACHE_KEY_PREFIX = 'tenant_module_availability:v2:'
const CACHE_TAG_ALL = 'tenant_module_availability:all'
const EMPTY_SET: ReadonlySet<string> = new Set<string>()

const logger = createLogger('tenant_module_availability')

type CachedAvailability = { unavailable: string[] }

type TenantRuntimeState = {
  inflight: Promise<ReadonlySet<string>> | null
  failedUntil: number | null
}

const runtimeStates = new Map<string, TenantRuntimeState>()
const tenantGenerations = new Map<string, number>()
const reportedRegistrationProblems = new Set<string>()
let generationEvictionEpoch = 0

function buildRuntimeStateKey(governedSignature: string, tenantId: string): string {
  return `${governedSignature}\u0000${tenantId}`
}

function getRuntimeState(key: string): TenantRuntimeState {
  const existing = runtimeStates.get(key)
  if (existing) {
    runtimeStates.delete(key)
    runtimeStates.set(key, existing)
    return existing
  }
  for (const [candidateKey, candidate] of runtimeStates) {
    if (runtimeStates.size < MAX_TRACKED_TENANT_MODULE_AVAILABILITY_STATES) break
    if (!candidate.inflight) runtimeStates.delete(candidateKey)
  }
  const created: TenantRuntimeState = { inflight: null, failedUntil: null }
  runtimeStates.set(key, created)
  return created
}

/**
 * Opaque per-tenant version of the availability answer. It changes whenever
 * the tenant is invalidated in this process; it also changes for every tenant
 * when a tenant's version is evicted from the bounded store, so an answer that
 * was in flight across an eviction is never mistaken for a current one.
 */
export function getTenantModuleAvailabilityGeneration(tenantId: string): string {
  return `${generationEvictionEpoch}:${tenantGenerations.get(tenantId) ?? 0}`
}

function bumpGeneration(tenantId: string): void {
  const next = (tenantGenerations.get(tenantId) ?? 0) + 1
  tenantGenerations.delete(tenantId)
  tenantGenerations.set(tenantId, next)
  while (tenantGenerations.size > MAX_TRACKED_TENANT_MODULE_AVAILABILITY_STATES) {
    const oldest = tenantGenerations.keys().next().value
    if (oldest === undefined) break
    tenantGenerations.delete(oldest)
    generationEvictionEpoch += 1
  }
  for (const [key, state] of runtimeStates) {
    if (key.endsWith(`\u0000${tenantId}`)) {
      state.inflight = null
      state.failedUntil = null
    }
  }
}

function reportFailure(error: unknown, code: string, message: string, attributes: Record<string, string>): void {
  logger.error(message, {
    ...attributes,
    message: error instanceof Error ? error.message : String(error),
  })
  getTelemetryRuntime()?.reportError(error, {
    module: 'tenant_module_availability',
    code,
    attributes,
  })
}

/** @internal Test-only: forget in-process availability state. */
export function resetTenantModuleAvailabilityStateForTests(): void {
  runtimeStates.clear()
  tenantGenerations.clear()
  generationEvictionEpoch = 0
  reportedRegistrationProblems.clear()
}

export function buildTenantModuleAvailabilityCacheTag(tenantId: string): string {
  return `tenant_module_availability:tenant:${tenantId}`
}

function buildCacheKey(governedSignature: string, tenantId: string): string {
  return `${CACHE_KEY_PREFIX}${governedSignature}:${tenantId}`
}

const INVALIDATION_STAMP_KEY_PREFIX = 'tenant_module_availability_stamp:v1:'

function buildInvalidationStampKey(tenantId: string): string {
  return `${INVALIDATION_STAMP_KEY_PREFIX}${tenantId}`
}

function createInvalidationStamp(): string {
  return `${Date.now()}:${Math.random().toString(36).slice(2)}`
}

function clamp(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.floor(value), 1), max)
}

function isCachedAvailability(value: unknown): value is CachedAvailability {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<CachedAvailability>
  return Array.isArray(record.unavailable) && record.unavailable.every((entry) => typeof entry === 'string')
}

function isTenantModuleAvailabilityProvider(value: unknown): value is TenantModuleAvailabilityProvider {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<TenantModuleAvailabilityProvider>
  return Array.isArray(record.governedModuleIds)
    && typeof record.getUnavailableModuleIds === 'function'
}

function isTenantModuleAvailabilityCache(value: unknown): value is TenantModuleAvailabilityCache {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<TenantModuleAvailabilityCache>
  return typeof record.get === 'function'
    && typeof record.set === 'function'
    && typeof record.delete === 'function'
    && typeof record.deleteByTags === 'function'
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[internal] tenant module availability provider timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * Wraps a provider with a per-tenant cache, single-flight and fail-closed
 * handling. In-flight calls, failure back-off and invalidation generations live
 * in a bounded module-level store keyed by tenant and by the provider's
 * governed-module set, so a provider object re-created per request (as DI
 * registrars that run per request do) still shares them.
 */
export function createTenantModuleAvailability(
  options: CreateTenantModuleAvailabilityOptions,
): TenantModuleAvailability {
  const { provider } = options
  const cache = options.cache ?? null
  const governed: ReadonlySet<string> = new Set(
    provider.governedModuleIds.filter((moduleId) => typeof moduleId === 'string' && moduleId.length > 0),
  )
  const governedSignature = Array.from(governed).sort().join(',')
  const ttlMs = clamp(provider.cacheTtlMs, DEFAULT_TENANT_MODULE_AVAILABILITY_TTL_MS, MAX_TENANT_MODULE_AVAILABILITY_TTL_MS)
  const timeoutMs = clamp(provider.timeoutMs, DEFAULT_TENANT_MODULE_AVAILABILITY_TIMEOUT_MS, MAX_TENANT_MODULE_AVAILABILITY_TIMEOUT_MS)
  const failureRetryMs = typeof options.failureRetryMs === 'number' && options.failureRetryMs >= 0
    ? options.failureRetryMs
    : DEFAULT_TENANT_MODULE_AVAILABILITY_FAILURE_RETRY_MS

  const readCache = async (tenantId: string): Promise<ReadonlySet<string> | null> => {
    if (!cache) return null
    try {
      const cached = await runWithCacheTenant(tenantId, () => cache.get(buildCacheKey(governedSignature, tenantId)))
      return isCachedAvailability(cached) ? new Set(cached.unavailable) : null
    } catch (error) {
      reportFailure(error, 'tenant_module_availability.cache_read_failed', 'Tenant module availability cache read failed; asking the provider', { tenantId })
      return null
    }
  }

  const readInvalidationStamp = async (tenantId: string): Promise<string | null> => {
    if (!cache) return null
    const stamp = await runWithCacheTenant(tenantId, () => cache.get(buildInvalidationStampKey(tenantId)))
    return typeof stamp === 'string' ? stamp : null
  }

  const writeCache = async (
    tenantId: string,
    unavailable: ReadonlySet<string>,
    stampAtStart: string | null,
  ): Promise<void> => {
    if (!cache) return
    const value: CachedAvailability = { unavailable: Array.from(unavailable) }
    const key = buildCacheKey(governedSignature, tenantId)
    try {
      if (await readInvalidationStamp(tenantId) !== stampAtStart) return
      await runWithCacheTenant(tenantId, () => cache.set(key, value, {
        ttl: ttlMs,
        tags: [buildTenantModuleAvailabilityCacheTag(tenantId), CACHE_TAG_ALL],
      }))
    } catch (error) {
      reportFailure(error, 'tenant_module_availability.cache_write_failed', 'Tenant module availability cache write failed; the answer is not cached', { tenantId })
      return
    }
    let stampChanged = true
    try {
      stampChanged = await readInvalidationStamp(tenantId) !== stampAtStart
    } catch (error) {
      reportFailure(error, 'tenant_module_availability.cache_recheck_failed', 'Tenant module availability could not re-check its invalidation stamp; dropping the cached answer', { tenantId })
    }
    if (!stampChanged) return
    try {
      await runWithCacheTenant(tenantId, () => cache.delete(key))
    } catch (error) {
      reportFailure(error, 'tenant_module_availability.cache_write_failed', 'Tenant module availability could not drop a possibly stale cached answer', { tenantId })
    }
  }

  const queryProvider = async (tenantId: string, state: TenantRuntimeState): Promise<ReadonlySet<string>> => {
    const generation = getTenantModuleAvailabilityGeneration(tenantId)
    let stampAtStart: string | null = null
    try {
      stampAtStart = await readInvalidationStamp(tenantId)
    } catch (error) {
      reportFailure(error, 'tenant_module_availability.cache_read_failed', 'Tenant module availability cache read failed; asking the provider', { tenantId })
    }
    try {
      const answer = await withTimeout(
        Promise.resolve().then(() => provider.getUnavailableModuleIds({ tenantId })),
        timeoutMs,
      )
      if (!Array.isArray(answer)) {
        throw new Error('[internal] tenant module availability provider returned a non-array value')
      }
      const unavailable = new Set<string>()
      for (const moduleId of answer) {
        if (typeof moduleId === 'string' && governed.has(moduleId)) unavailable.add(moduleId)
      }
      if (getTenantModuleAvailabilityGeneration(tenantId) === generation) {
        state.failedUntil = null
        await writeCache(tenantId, unavailable, stampAtStart)
      }
      return unavailable
    } catch (error) {
      if (getTenantModuleAvailabilityGeneration(tenantId) === generation) state.failedUntil = Date.now() + failureRetryMs
      reportFailure(
        error,
        'tenant_module_availability.provider_failed',
        'Tenant module availability provider failed; governed modules are unavailable for the tenant',
        { tenantId, governedModuleIds: governedSignature },
      )
      return governed
    }
  }

  const getUnavailableModuleIds = async (
    context: TenantModuleAvailabilityContext,
  ): Promise<ReadonlySet<string>> => {
    const tenantId = context.tenantId
    if (!governed.size || !tenantId) return EMPTY_SET

    const cached = await readCache(tenantId)
    if (cached) return cached

    const state = getRuntimeState(buildRuntimeStateKey(governedSignature, tenantId))
    if (state.failedUntil !== null) {
      if (state.failedUntil > Date.now()) return governed
      state.failedUntil = null
    }
    if (state.inflight) return state.inflight

    const request = queryProvider(tenantId, state)
    state.inflight = request
    request.finally(() => {
      if (state.inflight === request) state.inflight = null
    }).catch(() => undefined)
    return request
  }

  return {
    getUnavailableModuleIds,
    async isModuleAvailable(moduleId, context) {
      if (!governed.has(moduleId)) return true
      const unavailable = await getUnavailableModuleIds(context)
      return !unavailable.has(moduleId)
    },
    async invalidate(tenantId) {
      if (!tenantId) return
      bumpGeneration(tenantId)
      if (!cache) return
      await runWithCacheTenant(tenantId, async () => {
        await cache.set(buildInvalidationStampKey(tenantId), createInvalidationStamp(), {
          ttl: MAX_TENANT_MODULE_AVAILABILITY_TTL_MS,
        })
        await cache.deleteByTags([buildTenantModuleAvailabilityCacheTag(tenantId)])
      })
      bumpGeneration(tenantId)
    },
  }
}

function reportRegistrationProblemOnce(code: string, error: unknown, message: string): void {
  if (reportedRegistrationProblems.has(code)) return
  reportedRegistrationProblems.add(code)
  reportFailure(error, code, message, { key: TENANT_MODULE_AVAILABILITY_PROVIDER_DI_KEY })
}

/**
 * Builds the cached availability service from the app-registered provider, or
 * returns `null` when no (valid) provider is registered. Realm services treat
 * `null` as "no per-tenant restriction" and skip every availability branch.
 * An invalid or unresolvable registration is reported once per process.
 */
export function resolveTenantModuleAvailability(
  container: TenantModuleAvailabilityContainer,
): TenantModuleAvailability | null {
  try {
    if (!container.hasRegistration(TENANT_MODULE_AVAILABILITY_PROVIDER_DI_KEY)) return null
    const provider = container.resolve<unknown>(TENANT_MODULE_AVAILABILITY_PROVIDER_DI_KEY)
    if (!isTenantModuleAvailabilityProvider(provider)) {
      reportRegistrationProblemOnce(
        'tenant_module_availability.provider_invalid',
        new Error('[internal] tenant module availability provider registration is not a provider'),
        'Ignoring an invalid tenant module availability provider registration',
      )
      return null
    }
    let cache: TenantModuleAvailabilityCache | null = null
    if (container.hasRegistration('cache')) {
      const candidate = container.resolve<unknown>('cache')
      if (isTenantModuleAvailabilityCache(candidate)) cache = candidate
    }
    return createTenantModuleAvailability({ provider, cache })
  } catch (error) {
    reportRegistrationProblemOnce(
      'tenant_module_availability.provider_unresolved',
      error,
      'Failed to resolve the tenant module availability provider',
    )
    return null
  }
}
