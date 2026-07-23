import { asFunction, createContainer, asValue, AwilixContainer, InjectionMode, type Resolver } from 'awilix'
import { RequestContext } from '@mikro-orm/core'
import { getOrm } from '@open-mercato/shared/lib/db/mikro'
import { EntityManager } from '@mikro-orm/postgresql'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import { DefaultDataEngine } from '@open-mercato/shared/lib/data/engine'
import { commandRegistry, CommandBus } from '@open-mercato/shared/lib/commands'
import { applyDiOverridesToContainer } from '@open-mercato/shared/modules/overrides'
import { createOptimisticLockGuardService } from '@open-mercato/shared/lib/crud/optimistic-lock'
import { getAllOptimisticLockReaders } from '@open-mercato/shared/lib/crud/optimistic-lock-store'
import { createCommandOptimisticLockGuardService } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { createLogger } from '../logger'

const logger = createLogger('shared').child({ component: 'di' })

type DynamicCradle = Record<string, any>

export type AppContainer = AwilixContainer<DynamicCradle>
export type DiRegistrar = (container: AppContainer) => void

// Registration pattern for publishable packages
// Use globalThis to survive tsx/esbuild module duplication issue where the same
// file can be loaded as multiple module instances when mixing dynamic and static imports
const GLOBAL_KEY = '__openMercatoDiRegistrars__'
// Phase 5 — process-scoped bootstrap cache. The cache/event-bus/encryption
// services bootstrap() creates are inherently process-scoped (they hold
// state across requests). Caching them on globalThis after the first
// successful bootstrap call lets every subsequent request skip the
// `await bootstrap(container)` body and just re-register the cached
// instances. Same globalThis pattern as registerDiRegistrars so HMR
// keeps working.
const BOOTSTRAP_CACHE_KEY = '__openMercatoBootstrapCache__'
const ENCRYPTION_ENABLED_KEY = '__openMercatoEncryptionEnabledCache__'

const BOOTSTRAP_CACHE_KEYS = [
  'cache',
  'eventBus',
  'kmsService',
  'tenantEncryptionService',
  'rateLimiterService',
  'searchModuleConfigs',
  'searchIndexer',
] as const

type BootstrapCacheEntry = Partial<Record<(typeof BOOTSTRAP_CACHE_KEYS)[number], unknown>>

// Phase 5 is opt-in. Some bootstrap services close over per-request state
// (e.g. tenantEncryptionService captures the first request's `em.fork`, the
// event-bus's resolver closes over the first container) so naively replaying
// them on later requests yields stale references — observed as a 500 from
// CRUD list endpoints in `next start`. Default OFF preserves develop's
// per-request bootstrap. Set `OM_BOOTSTRAP_CACHE=1` to opt in once each
// cached service is verified safe for cross-request reuse.
function isBootstrapCacheEnabled(): boolean {
  const raw = process.env.OM_BOOTSTRAP_CACHE
  if (raw === undefined) return false
  const normalized = raw.trim().toLowerCase()
  if (!normalized.length) return false
  if (normalized === '0' || normalized === 'off' || normalized === 'false' || normalized === 'no') return false
  return true
}

function getBootstrapCache(): BootstrapCacheEntry | null {
  if (!isBootstrapCacheEnabled()) return null
  const existing = (globalThis as any)[BOOTSTRAP_CACHE_KEY]
  return existing && typeof existing === 'object' ? (existing as BootstrapCacheEntry) : null
}

function setBootstrapCache(entry: BootstrapCacheEntry): void {
  if (!isBootstrapCacheEnabled()) return
  ;(globalThis as any)[BOOTSTRAP_CACHE_KEY] = entry
}

function harvestBootstrapCache(container: AwilixContainer): BootstrapCacheEntry {
  const entry: BootstrapCacheEntry = {}
  for (const key of BOOTSTRAP_CACHE_KEYS) {
    try {
      const value: unknown = container.resolve(key as never)
      if (value !== undefined && value !== null) entry[key] = value
    } catch {
      // not registered — skip
    }
  }
  return entry
}

type EncryptionEnabledProbe = { isEnabled?: () => boolean } | null | undefined

function getCachedEncryptionEnabled(service: EncryptionEnabledProbe): boolean | null {
  if (!service || typeof service.isEnabled !== 'function') return false
  const cached = (globalThis as Record<string, unknown>)[ENCRYPTION_ENABLED_KEY]
  if (typeof cached === 'boolean') return cached
  try {
    const result = !!service.isEnabled()
    ;(globalThis as Record<string, unknown>)[ENCRYPTION_ENABLED_KEY] = result
    return result
  } catch {
    return null
  }
}

function getGlobalRegistrars(): DiRegistrar[] | null {
  return (globalThis as any)[GLOBAL_KEY] ?? null
}

function setGlobalRegistrars(registrars: DiRegistrar[]): void {
  (globalThis as any)[GLOBAL_KEY] = registrars
}

export function registerDiRegistrars(registrars: DiRegistrar[]) {
  const existing = getGlobalRegistrars()
  if (existing !== null && process.env.NODE_ENV === 'development') {
    logger.debug('DI registrars re-registered (this may occur during HMR)')
  }
  setGlobalRegistrars(registrars)
  // Force re-bootstrap on HMR — module subscribers may have changed.
  ;(globalThis as any)[BOOTSTRAP_CACHE_KEY] = null
  ;(globalThis as any)[ENCRYPTION_ENABLED_KEY] = undefined
}

export function getDiRegistrars(): DiRegistrar[] {
  const registrars = getGlobalRegistrars()
  if (!registrars) {
    throw new Error('[Bootstrap] DI registrars not registered. Call registerDiRegistrars() at bootstrap.')
  }
  return registrars
}

/** Test-only helper to drop the process-scoped bootstrap cache. */
export function resetBootstrapCache(): void {
  (globalThis as any)[BOOTSTRAP_CACHE_KEY] = null
  ;(globalThis as any)[ENCRYPTION_ENABLED_KEY] = undefined
}

function isAppDiModuleNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  const text = typeof message === 'string' ? message : ''
  const moduleNotFound =
    code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND' || text.startsWith('Cannot find module')
  return moduleNotFound && text.includes('@/di')
}

function isAwilixResolver(value: unknown): value is Resolver<unknown> {
  return Boolean(value && typeof value === 'object' && typeof (value as { resolve?: unknown }).resolve === 'function')
}

function toAwilixRegistrations(registrations: Record<string, unknown>): Record<string, Resolver<any>> {
  return Object.fromEntries(
    Object.entries(registrations).map(([key, value]) => [
      key,
      isAwilixResolver(value) ? value : asValue(value),
    ]),
  )
}

export async function createRequestContainer(): Promise<AppContainer> {
  const diRegistrars = getDiRegistrars()
  const orm = await getOrm()
  // Use a fresh event manager so request-level subscribers (e.g., encryption) don't pile up globally
  const baseEm = (RequestContext.getEntityManager() as any) ?? orm.em
  const em = baseEm.fork({ clear: true, freshEventManager: true, useContext: true }) as unknown as EntityManager
  const container = createContainer<DynamicCradle>({ injectionMode: InjectionMode.CLASSIC })
  // Core registrations
  container.register({
    em: asValue(em),
    queryEngine: asValue(new BasicQueryEngine(em, undefined, () => {
      try { return container.resolve('tenantEncryptionService') as any } catch { return null }
    })),
    dataEngine: asValue(new DefaultDataEngine(em, container as any)),
    commandRegistry: asValue(commandRegistry),
    commandBus: asValue(new CommandBus()),
    // Default OSS optimistic-lock guard. Reads from the global reader store
    // (populated by `makeCrudRoute` auto-registration + any module-DI
    // hand-wired calls to `registerOptimisticLockReaders`). Service is
    // strictly additive: when `OM_OPTIMISTIC_LOCK=off` (or no header is
    // sent) it short-circuits at validateMutation. Module-level di.ts
    // registrations override this default via Awilix replace semantics —
    // see the enterprise `record_locks` module for the canonical override.
    // Spec: .ai/specs/implemented/2026-05-25-oss-optimistic-locking.md
    crudMutationGuardService: asFunction(({ em: scopedEm }: { em: EntityManager }) =>
      createOptimisticLockGuardService({
        getEm: () => scopedEm,
        readers: getAllOptimisticLockReaders(),
      }),
    ).scoped(),
    // Default OSS command-level optimistic-lock guard, awaited by
    // `enforceCommandOptimisticLockWithGuards` for Command-pattern writes.
    // Header/explicit-token compare only (no `resolveExpected`), so it is
    // behaviourally identical to calling `enforceCommandOptimisticLock`
    // directly. The enterprise `record_locks` module overrides this DI key
    // with a lock-backed `resolveExpected` via Awilix replace semantics.
    // Spec: .ai/specs/enterprise/2026-06-09-record-locks-unified-coverage.md (Phase 0)
    commandOptimisticLockGuardService: asFunction(() =>
      createCommandOptimisticLockGuardService(),
    ).scoped(),
  })
  // Allow modules to override/extend
  for (const reg of diRegistrars) {
    try { reg?.(container) } catch {}
  }
  // Core bootstrap (cache, event bus, encryption subscriber/KMS, module subscribers)
  // Phase 5 — process-scoped once-guard. The first request runs the full
  // bootstrap() body; later requests re-register the cached services
  // directly on this request's container without re-importing or
  // re-initializing anything. HMR clears the cache (see
  // registerDiRegistrars). Skippable if a caller already wired eventBus.
  const alreadyBootstrappedOnThisContainer = !!container.registrations?.eventBus
  if (!alreadyBootstrappedOnThisContainer) {
    const cached = getBootstrapCache()
    if (cached) {
      const replay: Record<string, any> = {}
      for (const [key, value] of Object.entries(cached)) {
        if (value !== undefined && value !== null) replay[key] = asValue(value)
      }
      if (Object.keys(replay).length > 0) container.register(replay)
    } else {
      try {
        const { bootstrap } = await import('@open-mercato/core/bootstrap') as any
        if (bootstrap && typeof bootstrap === 'function') {
          await bootstrap(container)
          setBootstrapCache(harvestBootstrapCache(container))
        }
      } catch { /* optional */ }
    }
  }
  // App-level DI override (last chance)
  // This import path resolves only in the app context, not in packages
  try {
    // @ts-ignore - @/di only exists in app context, not in packages
    const appDi = await import('@/di') as any
    if (appDi?.register) {
      try {
        const maybe = appDi.register(container)
        if (maybe && typeof maybe.then === 'function') await maybe
      } catch (err) {
        logger.warn('App-level DI override (src/di.ts register()) threw; its registrations are skipped', { err })
      }
    }
  } catch (err) {
    if (isAppDiModuleNotFound(err)) {
      // Optional hook: most apps have no src/di.ts, so an unresolvable @/di is
      // the normal case and must stay quiet. CAVEAT: apps consuming this file
      // as a precompiled package (npm install instead of the monorepo) cannot
      // resolve the @/di alias from package context either, so this branch
      // also fires when src/di.ts EXISTS — the debug line keeps that failure
      // mode diagnosable via OM_LOG_LEVEL=debug. Such apps should register
      // overrides through modules.ts (`entry.overrides`) instead.
      logger.debug('App-level DI override module (@/di) not resolvable; skipping', { err })
    } else {
      logger.warn('App-level DI override module (@/di) failed to load; its registrations are skipped', { err })
    }
  }
  applyDiOverridesToContainer({
    register: (registrations) => container.register(toAwilixRegistrations(registrations)),
    unregister: (key) => container.register({ [key]: asValue(undefined) }),
  })
  // Ensure tenant encryption subscriber is always registered on the fresh request-scoped EM
  // Phase 5 — cache `tenantEncryptionService.isEnabled()` for the process
  // lifetime. The result depends only on config that does not change at
  // runtime, so reading it once skips a config lookup per request.
  try {
    const emForEnc = container.resolve('em') as any
    const tenantEncryptionService = container.hasRegistration('tenantEncryptionService')
      ? (container.resolve('tenantEncryptionService') as any)
      : null
    if (emForEnc && tenantEncryptionService && getCachedEncryptionEnabled(tenantEncryptionService) === true) {
      const { registerTenantEncryptionSubscriber } = await import('@open-mercato/shared/lib/encryption/subscriber')
      registerTenantEncryptionSubscriber(emForEnc, tenantEncryptionService)
    }
  } catch {
    // best-effort; do not block container creation
  }
  return container
}
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('server-only')
} catch {
  // allow CLI/generator usage where Next server-only is not present
}
