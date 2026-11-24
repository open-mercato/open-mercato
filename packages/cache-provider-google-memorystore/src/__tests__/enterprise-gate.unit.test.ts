import { defineEnterpriseGateSuite } from '@open-mercato/cache-provider-managed-kit/testing/gate'
import { createGoogleMemorystoreProvider, googleMemorystoreCacheProviderRegistration } from '../index'

defineEnterpriseGateSuite({
  createProvider: (options) => createGoogleMemorystoreProvider(options),
  registration: googleMemorystoreCacheProviderRegistration,
  validSettings: {
    product: 'valkey',
    clusterMode: 'enabled',
    discoveryEndpoint: { host: '10.0.0.3' },
    auth: { kind: 'iam' },
    tls: { ca: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n' },
  },
})
