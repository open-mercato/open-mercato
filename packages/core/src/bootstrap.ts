import type { AwilixContainer } from 'awilix'
import { asValue } from 'awilix'
import { createEventBus } from '@open-mercato/events/index'

export async function bootstrap(container: AwilixContainer) {
  // Create and register the DI-aware event bus
  const eventBus = createEventBus({ resolve: container.resolve.bind(container) as any })
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
