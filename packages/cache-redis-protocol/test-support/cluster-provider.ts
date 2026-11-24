import { defineCacheProvider } from '@open-mercato/cache/provider'
import type { CacheProviderDefinition } from '@open-mercato/cache/provider'
import { createRespCacheProvider } from '../src/provider'
import { createRespSettingsSchema } from '../src/settings'
import type { RespSettings } from '../src/settings'

export const CLUSTER_TEST_PROVIDER_ID = 'open-mercato/resp-cluster-test'

export const provider: CacheProviderDefinition<RespSettings> = defineCacheProvider(createRespCacheProvider({
  id: CLUSTER_TEST_PROVIDER_ID,
  settings: createRespSettingsSchema(),
  expectedEngine: 'valkey',
}))
