import { defineCacheProvider, type CacheProviderDefinition } from '@open-mercato/cache/provider'
import { PROVIDER_ID, createHotRodGateway, loadHotRodConnector, type HotRodConnector } from './client'
import { infinispanSettingsSchema, redactInfinispanSettings, type InfinispanSettings } from './settings'
import { createInfinispanStrategy } from './strategy'

export type CreateInfinispanProviderOptions = {
  connector?: HotRodConnector
}

export function createInfinispanProvider(options: CreateInfinispanProviderOptions = {}): CacheProviderDefinition<InfinispanSettings> {
  return defineCacheProvider<InfinispanSettings>({
    id: PROVIDER_ID,
    settings: infinispanSettingsSchema,
    capability: () => ({ placement: 'shared' }),
    async create(config, context) {
      const connector = options.connector ?? await loadHotRodConnector()
      const gateway = createHotRodGateway({ connector, config })
      try {
        await gateway.connect()
      } catch (error) {
        await gateway.close()
        throw error
      }
      return createInfinispanStrategy({ gateway, config, context })
    },
    redact: redactInfinispanSettings,
  })
}

export const provider = createInfinispanProvider()

export default provider
