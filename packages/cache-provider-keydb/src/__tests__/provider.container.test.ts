import path from 'node:path'
import { defineRespProviderContainerSuite } from '@open-mercato/cache-redis-protocol/test-support/suite'
import { provider } from '../index'

defineRespProviderContainerSuite({
  label: 'eqalpha/keydb:arm64_v6.3.4 · standalone · ACL + TLS',
  provider,
  providerEntry: path.resolve(__dirname, '../index.ts'),
  packageName: '@open-mercato/cache-provider-keydb',
  packageDirName: 'cache-provider-keydb',
  engine: { image: 'eqalpha/keydb:arm64_v6.3.4', serverBinary: 'keydb-server', tls: true },
})
