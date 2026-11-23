import type { AwilixContainer } from 'awilix'
import { asValue } from 'awilix'
import { getDefaultEncryptionMaps, type ModuleSubscriber } from '@open-mercato/shared/modules/registry'
import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'
import { createScopedEventBusFactory, type EventBus } from '@open-mercato/events/index'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import { createCacheService } from '@open-mercato/cache'
import type { CacheStrategy } from '@open-mercato/cache'
import { createKmsService, type KmsService } from '@open-mercato/shared/lib/encryption/kms'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { registerTenantEncryptionSubscriber } from '@open-mercato/shared/lib/encryption/subscriber'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import { warnUnresolvedEncryptionMapEntityIds } from '@open-mercato/shared/lib/encryption/unresolvedMapEntityIds'
import { getSearchModuleConfigs } from '@open-mercato/shared/modules/search'
import {
  registerSearchModule,
  createSearchDeleteSubscriber,
  searchDeleteMetadata,
} from '@open-mercato/search'
import { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { readRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { asScopedService, runProcessEventSetups } from '@open-mercato/shared/lib/di/process-registrar'
import { runInRequestScope, runWithRequestScopeContainer } from '@open-mercato/shared/lib/di/request-scope'
import { registerSyncSubscribers } from '@open-mercato/shared/lib/crud/sync-subscriber-store'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { registerScopedSearchModule } from '@open-mercato/search/di'
import type { SearchIndexer } from '@open-mercato/search'
import type { SearchDeletePayload } from '@open-mercato/shared/modules/search'

const logger = createLogger('core')

// Use globalThis to survive tsx/webpack module duplication (same pattern as container.ts DI registrars)
const RL_GLOBAL_KEY = '__openMercatoRateLimiterService__'
const RL_SHUTDOWN_KEY = '__openMercatoRateLimiterShutdown__'

const CACHE_GLOBAL_KEY = '__openMercatoCacheService__'
const CACHE_SHUTDOWN_KEY = '__openMercatoCacheShutdown__'

// Escape hatch: set OM_CACHE_SINGLETON=off to fall back to the legacy
// per-request cache instance (e.g. to isolate a regression). Default ON.
function isCacheSingletonEnabled(): boolean {
  const raw = process.env.OM_CACHE_SINGLETON
  if (raw === undefined) return true
  const normalized = raw.trim().toLowerCase()
  if (!normalized.length) return true
  return !(normalized === '0' || normalized === 'off' || normalized === 'false' || normalized === 'no')
}

/**
 * Process-wide cache service singleton, mirroring getCachedRateLimiterService.
 *
 * bootstrap() previously built a fresh cache per request container, so under
 * the default memory strategy every cross-request cache was a no-op (each
 * instance is process-local) and under sqlite each request leaked a native
 * handle. Reusing one instance is safe by construction: tenant scope resolves
 * per-call via AsyncLocalStorage (packages/cache/src/tenantContext.ts), so the
 * service holds no request-bound state.
 *
 * Returns null when disabled via the escape hatch or when creation fails, so
 * the caller falls back to a per-request instance.
 */
export function getCachedCacheService(): CacheStrategy | null {
  if (!isCacheSingletonEnabled()) return null
  let service = (globalThis as any)[CACHE_GLOBAL_KEY] as CacheStrategy | null ?? null
  if (!service) {
    try {
      try {
        service = createCacheService()
      } catch (err) {
        logger.warn('Cache service initialization failed; falling back to memory strategy', { err })
        service = createCacheService({ strategy: 'memory' })
      }
      ;(globalThis as any)[CACHE_GLOBAL_KEY] = service

      // Register shutdown hook once to close persistent handles (sqlite/redis) on process exit
      if (!(globalThis as any)[CACHE_SHUTDOWN_KEY]) {
        const shutdown = () => { service?.close?.().catch(() => {}) }
        process.once('SIGTERM', shutdown)
        process.once('SIGINT', shutdown)
        ;(globalThis as any)[CACHE_SHUTDOWN_KEY] = true
      }
    } catch (err) {
      logger.warn('Failed to create cache service', { component: 'cache', err })
    }
  }
  return service
}

export function getCachedRateLimiterService(): RateLimiterService | null {
  let service = (globalThis as any)[RL_GLOBAL_KEY] as RateLimiterService | null ?? null
  if (!service) {
    try {
      const rateLimitConfig = readRateLimitConfig()
      service = new RateLimiterService(rateLimitConfig)
      // Fire-and-forget async init (only needed for Redis strategy;
      // memory strategy works synchronously, and Redis has an in-memory
      // insurance limiter so the first few requests are still protected)
      service.initialize().catch((err) => {
        logger.warn('Async initialization failed', { component: 'ratelimit', err })
      })
      ;(globalThis as any)[RL_GLOBAL_KEY] = service

      // Register shutdown hook once to disconnect Redis on process exit
      if (!(globalThis as any)[RL_SHUTDOWN_KEY]) {
        const shutdown = () => { service?.destroy().catch(() => {}) }
        process.once('SIGTERM', shutdown)
        process.once('SIGINT', shutdown)
        ;(globalThis as any)[RL_SHUTDOWN_KEY] = true
      }
    } catch (err) {
      logger.warn('Failed to create rate limiter service', { component: 'ratelimit', err })
    }
  }
  return service
}

export async function bootstrap(container: AwilixContainer) {
  // Register the cache service. Prefer the process-wide singleton so caches
  // survive across request containers; fall back to a per-request instance
  // when the singleton is disabled or fails to build.
  let cache: any = getCachedCacheService()
  if (!cache) {
    try {
      cache = createCacheService()
    } catch (err: any) {
      logger.warn('Cache service initialization failed; falling back to memory strategy', { err })
      cache = createCacheService({ strategy: 'memory' })
    }
  }
  container.register({ cache: asValue(cache) })

  const registerEventBus = (queueStrategy: 'local' | 'async'): EventBus => {
    const createScopedBus = createScopedEventBusFactory({ queueStrategy })
    container.register({
      eventBus: asScopedService((caller) => createScopedBus(
        <Value = unknown>(name: string, options?: { allowUnregistered?: boolean }) => caller.resolve<Value>(name, options),
        caller,
      )),
    })
    return createScopedBus.definitions
  }
  let definitions: EventBus
  try {
    const strategyEnv = process.env.QUEUE_STRATEGY || process.env.EVENTS_STRATEGY
    definitions = registerEventBus(strategyEnv === 'async' || strategyEnv === 'redis' ? 'async' : 'local')
  } catch (error) {
    logger.warn('Event bus initialization failed; falling back to local strategy', { err: error })
    try {
      getTelemetryRuntime()?.reportError(error, { module: 'core', code: 'core.event_bus_init_failed' })
    } catch (telemetryError) {
      logger.warn('Failed to report event bus initialization error', { err: telemetryError })
    }
    try {
      definitions = registerEventBus('local')
    } catch (error) {
      try {
        getTelemetryRuntime()?.reportError(error, { module: 'core', code: 'core.event_bus_fallback_failed' })
      } catch (telemetryError) {
        logger.warn('Failed to report event bus fallback error', { err: telemetryError })
      }
      // In extreme cases, provide a no-op bus to avoid crashes. It deliberately
      // omits `dispatchQueued` so the events worker fails its job loudly instead
      // of quietly completing it with zero subscribers dispatched.
      definitions = {
        emit: async () => {},
        emitEvent: async () => {},
        on: () => {},
        registerModuleSubscribers: () => {},
        clearQueue: async () => ({ removed: 0 }),
      }
      container.register({ eventBus: asValue(definitions) })
    }
  }
  const eventBus = container.resolve<EventBus>('eventBus')
  // Wire the global event bus so createModuleEvents().emit works outside DI context
  setGlobalEventBus(eventBus)
  // Auto-register discovered module subscribers
  try {
    let loadedModules: any[] = []
    try {
      const { getModules } = await import('@open-mercato/shared/lib/i18n/server')
      loadedModules = getModules()
    } catch (err) {
      // The events worker dispatches persistent subscribers through this bus, so
      // an empty registry here means queued events silently run nothing. Swallowing
      // it made that failure invisible; log it.
      logger.warn('Module registry unavailable; event bus starts with no module subscribers', { err })
    }
    const subs = loadedModules.flatMap((m) =>
      (m.subscribers || []).map((subscriber: ModuleSubscriber) => ({
        ...subscriber,
        moduleId: subscriber.moduleId ?? m.id,
      })),
    )
    if (subs.length) definitions.registerModuleSubscribers(subs)

    // Extract sync subscribers and register in the sync-subscriber-store
    const syncSubs = subs.filter((s: any) => s.sync === true)
    if (syncSubs.length) {
      try {
        const { registerSyncSubscribers } = await import('@open-mercato/shared/lib/crud/sync-subscriber-store')
        registerSyncSubscribers(
          syncSubs.map((s: any) => ({
            metadata: { event: s.event, sync: true as const, priority: s.priority, id: s.id },
            handler: s.handler,
          })),
        )
      } catch {
        // sync-subscriber-store may not be available
      }
    }
  } catch (err) {
    logger.error("Failed to register module subscribers:", { err });
  }

  // KMS + tenant encryption
  const kmsService = createKmsService()
  container.register({ kmsService: asValue(kmsService) })
  let defaultEncryptionMaps: ModuleEncryptionMap[] = []
  if (isTenantDataEncryptionEnabled()) {
    try {
      const { getModules } = await import('@open-mercato/shared/lib/i18n/server')
      defaultEncryptionMaps = getDefaultEncryptionMaps(getModules())
    } catch (err) {
      logger.error('Failed to load default encryption maps', { component: 'encryption', err })
      throw err
    }
    warnUnresolvedEncryptionMapEntityIds(defaultEncryptionMaps)
  }
  try {
    const em = container.resolve('em') as EntityManager
    const cacheService = (() => {
      try { return container.resolve('cache') as any } catch { return null }
    })()
    const tenantEncryptionService = new TenantDataEncryptionService(em, {
      cache: cacheService,
      kms: kmsService,
      defaultEncryptionMaps,
    })
    container.register({ tenantEncryptionService: asValue(tenantEncryptionService) })
    // Register on the static config toggle only — never on KMS health. The
    // subscriber re-checks `service.isEnabled()` (which includes KMS health) on
    // every read/write, so registering while Vault is down is a no-op that
    // starts encrypting again the moment KMS recovers. Gating registration on
    // health instead left a boot-time outage fail-open for the whole process
    // lifetime, recoverable only by a restart (#5948).
    if (isTenantDataEncryptionEnabled()) {
      try {
        registerTenantEncryptionSubscriber(em, tenantEncryptionService)
      } catch (err) {
        logger.warn('Failed to register MikroORM encryption subscriber', { component: 'encryption', err })
      }
      if (!kmsService.isHealthy()) {
        logger.warn(
          'Vault/KMS unhealthy - tenant data encryption is paused until it recovers; the subscriber is registered and resumes automatically',
          { component: 'encryption' },
        )
      }
    }
  } catch (err) {
    logger.warn('Failed to initialize tenant encryption service', { component: 'encryption', err })
  }

  // Register rate limiter service (singleton via globalThis — reused across request containers)
  // getCachedRateLimiterService() never throws; returns null on failure
  const rateLimiterService = getCachedRateLimiterService()
  if (rateLimiterService) {
    container.register({ rateLimiterService: asValue(rateLimiterService) })
  }

  // Register search module
  try {
    // Get configs from global registry (registered during app bootstrap)
    const searchModuleConfigs = getSearchModuleConfigs()
    registerSearchModule(container as any, { moduleConfigs: searchModuleConfigs })

    // Register searchModuleConfigs in container so status API can access vector-enabled entities
    container.register({
      searchModuleConfigs: asValue(searchModuleConfigs),
    })

    // Register search delete event subscriber
    // Note: search.index_record is now handled by auto-discovered fulltext_upsert.ts subscriber
    try {
      const searchIndexer = container.resolve('searchIndexer') as any
      if (searchIndexer && eventBus) {
        definitions.registerModuleSubscribers([
          {
            id: 'search.delete_record',
            moduleId: 'search',
            event: searchDeleteMetadata.event,
            persistent: searchDeleteMetadata.persistent,
            handler: async (payload, context) => {
              const callerIndexer = context.resolve<SearchIndexer>('searchIndexer')
              await createSearchDeleteSubscriber(callerIndexer)(payload as SearchDeletePayload)
            },
          },
        ])
      }
    } catch {
      // searchIndexer may not be available
    }
  } catch (err) {
    logger.warn('Failed to register search module', { component: 'search', err })
  }
}

const KMS_GLOBAL_KEY = Symbol.for('@open-mercato/core/process-kms')
const processEventSetupBuses = new WeakMap<AwilixContainer, EventBus>()

/** @internal Completes generation-local setup after module and app registration. */
export async function finalizeProcessRoot(root: AwilixContainer): Promise<void> {
  const definitions = processEventSetupBuses.get(root)
  if (!definitions) return
  processEventSetupBuses.delete(root)
  await runProcessEventSetups(root, definitions)
}

function getProcessKmsService(): KmsService {
  const state = globalThis as typeof globalThis & { [KMS_GLOBAL_KEY]?: KmsService }
  if (!state[KMS_GLOBAL_KEY]) state[KMS_GLOBAL_KEY] = createKmsService()
  return state[KMS_GLOBAL_KEY]
}

export async function bootstrapProcessRoot(root: AwilixContainer): Promise<() => void> {
  const cache = getCachedCacheService()
  if (!cache) throw new Error('[internal] Process root requires the shared cache service')
  const kmsService = getProcessKmsService()
  const rateLimiterService = getCachedRateLimiterService()
  const searchModuleConfigs = getSearchModuleConfigs()
  const modules = getModules()
  const defaultEncryptionMaps = isTenantDataEncryptionEnabled() ? getDefaultEncryptionMaps(modules) : []
  warnUnresolvedEncryptionMapEntityIds(defaultEncryptionMaps)
  const strategy = process.env.QUEUE_STRATEGY || process.env.EVENTS_STRATEGY
  const createScopedBus = createScopedEventBusFactory({
    queueStrategy: strategy === 'async' || strategy === 'redis' ? 'async' : 'local',
  })
  const definitions = createScopedBus.definitions
  const subscribers = modules.flatMap((module) => (module.subscribers ?? []).map((subscriber) => ({
    ...subscriber,
    moduleId: subscriber.moduleId ?? module.id,
  })))
  definitions.registerModuleSubscribers(subscribers.map((subscriber) => ({
    ...subscriber,
    handler: async (payload, context) => { await subscriber.handler(payload, context) },
  })))
  definitions.on(searchDeleteMetadata.event, async (payload, context) => {
    const indexer = context.resolve<SearchIndexer>('searchIndexer')
    await createSearchDeleteSubscriber(indexer)(payload as SearchDeletePayload)
  }, { id: 'search.delete_record', moduleId: 'search', persistent: searchDeleteMetadata.persistent })

  root.register({
    cache: asValue(cache),
    kmsService: asValue(kmsService),
    searchModuleConfigs: asValue(searchModuleConfigs),
    tenantEncryptionService: asScopedService((caller) => new TenantDataEncryptionService(
      caller.resolve<EntityManager>('em'),
      { cache: caller.resolve<CacheStrategy>('cache'), kms: caller.resolve<KmsService>('kmsService'), defaultEncryptionMaps },
    )),
    eventBus: asScopedService((caller): EventBus => {
      const bus = createScopedBus(
        <Value = unknown>(name: string, options?: { allowUnregistered?: boolean }) => caller.resolve<Value>(name, options),
        caller,
      )
      const emit: EventBus['emit'] = (event, payload, options) =>
        runWithRequestScopeContainer(caller, () => bus.emit(event, payload, options))
      return {
        ...bus,
        emit,
        emitEvent: emit,
        dispatchQueued: (event, payload, options, resolve, container) => {
          const dispatch = () => bus.dispatchQueued!(event, payload, options, resolve, container)
          if (container) return runWithRequestScopeContainer(container, dispatch)
          return resolve ? dispatch() : runWithRequestScopeContainer(caller, dispatch)
        },
      }
    }),
  })
  if (rateLimiterService) root.register({ rateLimiterService: asValue(rateLimiterService) })
  registerScopedSearchModule(root, { moduleConfigs: searchModuleConfigs })
  processEventSetupBuses.set(root, definitions)

  return () => {
    registerSyncSubscribers(subscribers.filter((subscriber) => subscriber.sync === true).map((subscriber) => ({
      metadata: { event: subscriber.event, sync: true, priority: subscriber.priority, id: subscriber.id },
      handler: async (payload, context) => subscriber.handler(payload, context),
    })))
    setGlobalEventBus({
      emit: (event, payload, options) => runInRequestScope(async () => {
        const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
        const caller = await createRequestContainer()
        try {
          await caller.resolve<EventBus>('eventBus').emit(event, payload, options)
        } finally {
          await caller.dispose()
        }
      }),
    })
  }
}
