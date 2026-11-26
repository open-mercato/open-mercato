import { Redis } from 'ioredis'
import { startRespEngine } from '@open-mercato/cache-redis-protocol/test-support/engine'
import type { StartedRespEngine } from '@open-mercato/cache-redis-protocol/test-support/engine'
import { defineManagedProviderPreflight } from '@open-mercato/cache-provider-managed-kit/testing/preflight'
import type { PreflightTarget } from '@open-mercato/cache-provider-managed-kit/testing/preflight'
import { createAwsElastiCacheProvider } from '../index'

defineManagedProviderPreflight({
  label: 'valkey/valkey:8.1 · standalone primary (node-based, cluster mode disabled stand-in) · rotating ACL credential as IAM token · TLS',
  packageDirName: 'cache-provider-aws-elasticache',
  createProvider: (fixture) => createAwsElastiCacheProvider(fixture),
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
