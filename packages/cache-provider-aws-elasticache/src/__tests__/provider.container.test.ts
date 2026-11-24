import path from 'node:path'
import { Redis } from 'ioredis'
import { startRespEngine } from '@open-mercato/cache-redis-protocol/test-support/engine'
import type { StartedRespEngine } from '@open-mercato/cache-redis-protocol/test-support/engine'
import { provider } from '../../test-support/fixture-provider'
import { defineManagedProviderPreflight } from '../../test-support/preflight'
import type { PreflightTarget } from '../../test-support/preflight'

defineManagedProviderPreflight({
  label: 'valkey/valkey:8.1 · standalone primary (node-based, cluster mode disabled stand-in) · rotating ACL credential as IAM token · TLS',
  provider,
  fixtureEntry: path.resolve(__dirname, '../../test-support/fixture-provider.ts'),
  packageDirName: 'cache-provider-aws-elasticache',
  packed: { packageName: '@open-mercato/cache-provider-aws-elasticache', factoryExport: 'createAwsElastiCacheProvider', registrationExport: 'awsElastiCacheCacheProviderRegistration' },
  async start(): Promise<PreflightTarget> {
    const engine: StartedRespEngine = await startRespEngine({ image: 'valkey/valkey:8.1', serverBinary: 'valkey-server', tls: true })
    const admin: Redis = engine.admin()
    return {
      tls: engine.tls!,
      nodes: () => [admin],
      keyspace: () => admin,
      async stop() {
        admin.disconnect()
        await engine.stop()
      },
    }
  },
  settings(target, tls) {
    const admin = target.nodes()[0]
    return {
      engine: 'valkey',
      deployment: 'node-based',
      clusterMode: 'disabled',
      host: admin.options.host,
      port: admin.options.port,
      auth: { kind: 'iam', userId: 'om-cache', replicationGroupId: 'om-cache-preflight', region: 'eu-west-1' },
      tls: { ca: tls?.ca ?? target.tls.ca, servername: tls?.servername ?? 'localhost' },
      connectTimeoutMs: 5_000,
      commandTimeoutMs: 5_000,
      batchSize: 64,
    }
  },
})
