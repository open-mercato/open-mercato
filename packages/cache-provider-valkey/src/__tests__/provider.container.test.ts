import path from 'node:path'
import { defineRespProviderContainerSuite } from '@open-mercato/cache-redis-protocol/test-support/suite'
import { provider } from '../index'

defineRespProviderContainerSuite({
  label: 'valkey/valkey:8.1 · standalone · ACL + TLS',
  provider,
  providerEntry: path.resolve(__dirname, '../index.ts'),
  packageName: '@open-mercato/cache-provider-valkey',
  packageDirName: 'cache-provider-valkey',
  engine: { image: 'valkey/valkey:8.1', serverBinary: 'valkey-server', tls: true },
})
