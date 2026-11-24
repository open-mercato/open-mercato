import { defineEnterpriseGateSuite } from '@open-mercato/cache-provider-managed-kit/testing/gate'
import { provider } from '../index'

defineEnterpriseGateSuite({
  provider: provider as never,
  validSettings: {
    clusteringPolicy: 'non-clustered',
    host: 'om-cache.westeurope.redis.azure.net',
    auth: { kind: 'entra', identity: 'managed-identity' },
  },
})
