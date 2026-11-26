import { defineEnterpriseGateSuite } from '@open-mercato/cache-provider-managed-kit/testing/gate'
import { createAzureManagedRedisProvider, azureManagedRedisCacheProviderRegistration } from '../index'

defineEnterpriseGateSuite({
  createProvider: (options) => createAzureManagedRedisProvider(options),
  registration: azureManagedRedisCacheProviderRegistration,
  validSettings: {
    clusteringPolicy: 'non-clustered',
    host: 'om-cache.westeurope.redis.azure.net',
    auth: { kind: 'entra', identity: 'managed-identity' },
  },
})
