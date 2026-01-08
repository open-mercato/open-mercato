import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { EmbeddingService, VectorIndexService, createPgVectorDriver, createChromaDbDriver, createQdrantDriver } from '@open-mercato/vector'
import { vectorModuleConfigs } from '@/generated/vector.generated'

function resolveEventBus(container: AppContainer): { emitEvent: (...args: any[]) => Promise<any> } | undefined {
  const getBus = () => {
    try {
      return container.resolve('eventBus') as { emitEvent: (...args: any[]) => Promise<any> } | undefined
    } catch {
      return undefined
    }
  }

  const initial = getBus()
  if (!initial) {
    return {
      async emitEvent(...args: any[]) {
        const bus = getBus()
        if (!bus) {
          console.warn('[vector] eventBus unavailable, skipping emitEvent', { event: args[0] })
          return
        }
        return bus.emitEvent(...args)
      },
    }
  }
  return {
    async emitEvent(...args: any[]) {
      const bus = getBus()
      return bus ? bus.emitEvent(...args) : undefined
    },
  }
}

export function register(container: AppContainer) {
  const embeddingService = new EmbeddingService()
  const drivers = [
    createPgVectorDriver(),
    createChromaDbDriver(),
    createQdrantDriver(),
  ]

  const queryEngine = container.resolve('queryEngine') as any
  const eventBus = resolveEventBus(container)

  const indexService = new VectorIndexService({
    drivers,
    embeddingService,
    queryEngine,
    moduleConfigs: vectorModuleConfigs,
    containerResolver: () => container,
    eventBus,
  })

  container.register({
    vectorEmbeddingService: asValue(embeddingService),
    vectorDrivers: asValue(drivers),
    vectorIndexService: asValue(indexService),
  })
}
