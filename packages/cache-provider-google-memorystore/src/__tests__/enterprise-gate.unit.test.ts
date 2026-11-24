import { defineEnterpriseGateSuite } from '@open-mercato/cache-provider-managed-kit/testing/gate'
import { provider } from '../index'

defineEnterpriseGateSuite({
  provider: provider as never,
  validSettings: {
    product: 'valkey',
    clusterMode: 'enabled',
    discoveryEndpoint: { host: '10.0.0.3' },
    auth: { kind: 'iam' },
    tls: { ca: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n' },
  },
})
