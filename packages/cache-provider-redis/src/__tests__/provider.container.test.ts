import path from 'node:path'
import { defineRespProviderContainerSuite } from '@open-mercato/cache-redis-protocol/test-support/suite'
import { provider } from '../index'

defineRespProviderContainerSuite({
  label: 'redis:7.2 · standalone · ACL + TLS',
  provider,
  providerEntry: path.resolve(__dirname, '../index.ts'),
  packageName: '@open-mercato/cache-provider-redis',
  packageDirName: 'cache-provider-redis',
  engine: { image: 'redis:7.2', serverBinary: 'redis-server', tls: true },
})
