import type { AwilixContainer } from 'awilix'
import { asValue } from 'awilix'
import { createEventBus } from '@open-mercato/events/index'
import { createCacheService } from '@open-mercato/cache'

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
    const strategy = process.env.EVENTS_STRATEGY === 'redis' ? 'redis' : 'local'
    eventBus = createEventBus({ resolve: container.resolve.bind(container) as any, strategy })
  } catch (err: any) {
    // Fall back to local strategy to avoid breaking the app on misconfiguration
    console.warn('Event bus initialization failed; falling back to local strategy:', err?.message || err)
    try {
      eventBus = createEventBus({ resolve: container.resolve.bind(container) as any, strategy: 'local' })
    } catch {
      // In extreme cases, provide a no-op bus to avoid crashes
      eventBus = { emitEvent: async () => {}, on: () => {}, registerModuleSubscribers: () => {}, processOffline: async () => ({ processed: 0, lastId: 0 }), clearQueue: async () => ({ removed: 0 }), clearProcessed: async () => ({ removed: 0, lastId: 0 }) }
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
}
