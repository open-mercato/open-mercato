import type { AwilixContainer } from 'awilix'
import { asValue } from 'awilix'
import { createEventBus } from '@open-mercato/events/index'
import { createCacheService } from '@open-mercato/cache'
import { createKmsService } from '@open-mercato/shared/lib/encryption/kms'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { registerTenantEncryptionSubscriber } from '@open-mercato/shared/lib/encryption/subscriber'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import { getSearchModuleConfigs } from '@open-mercato/shared/modules/search'
import {
  registerSearchModule,
  createSearchDeleteSubscriber,
  searchDeleteMetadata,
} from '@open-mercato/search'
import { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { readRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import type { EntityManager } from '@mikro-orm/postgresql'

// Use globalThis to survive tsx/webpack module duplication (same pattern as container.ts DI registrars)
const RL_GLOBAL_KEY = '__openMercatoRateLimiterService__'
const RL_SHUTDOWN_KEY = '__openMercatoRateLimiterShutdown__'

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
        console.warn('[ratelimit] Async initialization failed:', (err as Error)?.message || err)
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
      console.warn('[ratelimit] Failed to create rate limiter service:', (err as Error)?.message || err)
    }
  }
  return service
}

export async function bootstrap(container: AwilixContainer) {
  // Create and register the cache service
  let cache: any
  try {
    cache = createCacheService()
  } catch (err: any) {
    console.warn('Cache service initialization failed; falling back to memory strategy:', err?.message || err)
    cache = createCacheService({ strategy: 'memory' })
  }
  container.register({ cache: asValue(cache) })

  // Create and register the DI-aware event bus
  let eventBus: any
  try {
    // Support both QUEUE_STRATEGY and legacy EVENTS_STRATEGY env vars
    const strategyEnv = process.env.QUEUE_STRATEGY || process.env.EVENTS_STRATEGY
    const queueStrategy = strategyEnv === 'async' || strategyEnv === 'redis' ? 'async' : 'local'
    eventBus = createEventBus({ resolve: container.resolve.bind(container) as any, queueStrategy })
  } catch (err: any) {
    // Fall back to local strategy to avoid breaking the app on misconfiguration
    console.warn('Event bus initialization failed; falling back to local strategy:', err?.message || err)
    try {
      eventBus = createEventBus({ resolve: container.resolve.bind(container) as any, queueStrategy: 'local' })
    } catch {
      // In extreme cases, provide a no-op bus to avoid crashes
      eventBus = {
        emit: async () => {},
        on: () => {},
        registerModuleSubscribers: () => {},
        clearQueue: async () => ({ removed: 0 }),
      }
    }
  }
  container.register({ eventBus: asValue(eventBus) })
  // Auto-register discovered module subscribers
  try {
    let loadedModules: any[] = []
    try {
      const { getModules } = await import('@open-mercato/shared/lib/i18n/server')
      loadedModules = getModules()
    } catch {}
    const subs = loadedModules.flatMap((m) => m.subscribers || [])
    if (subs.length) (container.resolve as any)('eventBus').registerModuleSubscribers(subs)
  } catch (err) {
    console.error("Failed to register module subscribers:", err);
  }

  // KMS + tenant encryption
  const kmsService = createKmsService()
  container.register({ kmsService: asValue(kmsService) })
  try {
    const em = container.resolve('em') as EntityManager
    const cacheService = (() => {
      try { return container.resolve('cache') as any } catch { return null }
    })()
    const tenantEncryptionService = new TenantDataEncryptionService(em, { cache: cacheService, kms: kmsService })
    container.register({ tenantEncryptionService: asValue(tenantEncryptionService) })
    if (isTenantDataEncryptionEnabled() && kmsService.isHealthy()) {
      try {
        registerTenantEncryptionSubscriber(em, tenantEncryptionService)
      } catch (err) {
        console.warn('[encryption] Failed to register MikroORM encryption subscriber:', (err as Error)?.message || err)
      }
    } else if (isTenantDataEncryptionEnabled() && !kmsService.isHealthy()) {
      console.warn('[encryption] Vault/KMS unhealthy - tenant data encryption is disabled until recovery')
    }
  } catch (err) {
    console.warn('[encryption] Failed to initialize tenant encryption service:', (err as Error)?.message || err)
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
        eventBus.registerModuleSubscribers([
          {
            event: searchDeleteMetadata.event,
            persistent: searchDeleteMetadata.persistent,
            handler: createSearchDeleteSubscriber(searchIndexer),
          },
        ])
      }
    } catch {
      // searchIndexer may not be available
    }
  } catch (err) {
    console.warn('[search] Failed to register search module:', (err as Error)?.message || err)
  }
}
