import { asValue } from 'awilix'
import type { AppContainer } from '@/lib/di/container'
import { EmbeddingService, VectorIndexService, createPgVectorDriver, createChromaDbDriver, createQdrantDriver } from '@open-mercato/vector'
import type { VectorModuleConfig } from '@open-mercato/vector'

// Registration pattern for publishable packages
let _vectorModuleConfigs: VectorModuleConfig[] | null = null

export function registerVectorConfigs(configs: VectorModuleConfig[]) {
  if (_vectorModuleConfigs !== null && process.env.NODE_ENV === 'development') {
    console.debug('[Bootstrap] Vector configs re-registered (this may occur during HMR)')
  }
  _vectorModuleConfigs = configs
}

export function getVectorConfigs(): VectorModuleConfig[] {
  if (!_vectorModuleConfigs) {
    throw new Error('[Bootstrap] Vector configs not registered. Call registerVectorConfigs() at bootstrap.')
  }
  return _vectorModuleConfigs
}

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
    moduleConfigs: getVectorConfigs(),
    containerResolver: () => container,
    eventBus,
  })

  container.register({
    vectorEmbeddingService: asValue(embeddingService),
    vectorDrivers: asValue(drivers),
    vectorIndexService: asValue(indexService),
  })
}
