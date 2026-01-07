import type { AwilixContainer } from 'awilix'
import { asValue } from 'awilix'
import { createEventBus } from '@open-mercato/events/index'
import { createCacheService } from '@open-mercato/cache'
import { createKmsService } from '@open-mercato/shared/lib/encryption/kms'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { registerTenantEncryptionSubscriber } from '@open-mercato/shared/lib/encryption/subscriber'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import {
  registerSearchModule,
  createSearchIndexSubscriber,
  createSearchDeleteSubscriber,
  searchIndexMetadata,
  searchDeleteMetadata,
} from '@open-mercato/search'
import type { EntityManager } from '@mikro-orm/postgresql'

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
      const mod = await import('@/generated/modules.generated') as any
      loadedModules = Array.isArray(mod?.modules) ? mod.modules : []
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

  // Register search module
  try {
    let searchModuleConfigs: any[] = []
    try {
      const mod = await import('@/generated/search.generated') as any
      searchModuleConfigs = mod?.searchModuleConfigs ?? []
    } catch {
      // search.generated.ts may not exist yet
    }
    registerSearchModule(container as any, { moduleConfigs: searchModuleConfigs })

    // Register search event subscribers
    try {
      const searchIndexer = container.resolve('searchIndexer') as any
      if (searchIndexer && eventBus) {
        eventBus.registerModuleSubscribers([
          {
            event: searchIndexMetadata.event,
            persistent: searchIndexMetadata.persistent,
            handler: createSearchIndexSubscriber(searchIndexer),
          },
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
