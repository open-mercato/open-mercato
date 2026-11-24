import { defineEnterpriseGateSuite } from '@open-mercato/cache-provider-managed-kit/testing/gate'
import { provider } from '../index'

defineEnterpriseGateSuite({
  provider: provider as never,
  validSettings: {
    engine: 'valkey',
    deployment: 'node-based',
    clusterMode: 'disabled',
    host: 'master.om-cache.abc123.euw1.cache.amazonaws.com',
    auth: { kind: 'iam', userId: 'om-cache', replicationGroupId: 'om-cache', region: 'eu-west-1' },
  },
})
