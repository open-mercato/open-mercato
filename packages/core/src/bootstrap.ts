import type { AwilixContainer } from 'awilix'
import { asValue } from 'awilix'
import { createEventBus } from '@mercato-core/lib/events'
import { modules } from '@/generated/modules.generated'

export async function bootstrap(container: AwilixContainer) {
  // Create and register the DI-aware event bus
  const eventBus = createEventBus({ resolve: container.resolve.bind(container) as any })
  container.register({ eventBus: asValue(eventBus) })
  // Auto-register discovered module subscribers
  try {
    const subs = modules.flatMap((m) => m.subscribers || [])
    if (subs.length) (container.resolve as any)('eventBus').registerModuleSubscribers(subs)
  } catch {}
}
