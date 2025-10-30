import { asValue } from 'awilix'
import type { AppContainer } from '@/lib/di/container'
import { EmbeddingService, VectorIndexService, createPgVectorDriver, createChromaDbDriver, createQdrantDriver } from '@open-mercato/vector'
import { vectorModuleConfigs } from '@/generated/vector.generated'

export function register(container: AppContainer) {
  const embeddingService = new EmbeddingService()
  const drivers = [
    createPgVectorDriver(),
    createChromaDbDriver(),
    createQdrantDriver(),
  ]

  const queryEngine = container.resolve('queryEngine') as any

  const indexService = new VectorIndexService({
    drivers,
    embeddingService,
    queryEngine,
    moduleConfigs: vectorModuleConfigs,
    containerResolver: () => container,
    eventBus: container.resolve('eventBus') as any,
  })

  container.register({
    vectorEmbeddingService: asValue(embeddingService),
    vectorDrivers: asValue(drivers),
    vectorIndexService: asValue(indexService),
  })
}
