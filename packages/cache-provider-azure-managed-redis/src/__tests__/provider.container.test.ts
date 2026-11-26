import { Redis } from 'ioredis'
import { startRespEngine } from '@open-mercato/cache-redis-protocol/test-support/engine'
import type { StartedRespEngine } from '@open-mercato/cache-redis-protocol/test-support/engine'
import { defineManagedProviderPreflight } from '@open-mercato/cache-provider-managed-kit/testing/preflight'
import type { PreflightTarget } from '@open-mercato/cache-provider-managed-kit/testing/preflight'
import { createAzureManagedRedisProvider } from '../index'

defineManagedProviderPreflight({
  label: 'redis:7.2 · standalone (Non-clustered stand-in) · rotating ACL credential as Entra token · TLS',
  packageDirName: 'cache-provider-azure-managed-redis',
  createProvider: (fixture) => createAzureManagedRedisProvider(fixture),
  packed: { packageName: '@open-mercato/cache-provider-azure-managed-redis', factoryExport: 'createAzureManagedRedisProvider', registrationExport: 'azureManagedRedisCacheProviderRegistration' },
  async start(): Promise<PreflightTarget> {
    const engine: StartedRespEngine = await startRespEngine({ image: 'redis:7.2', serverBinary: 'redis-server', tls: true })
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
      clusteringPolicy: 'non-clustered',
      host: admin.options.host,
      port: admin.options.port,
      auth: { kind: 'entra', identity: 'managed-identity' },
      tls: { ca: tls?.ca ?? target.tls.ca, servername: tls?.servername ?? 'localhost' },
      connectTimeoutMs: 5_000,
      commandTimeoutMs: 5_000,
      batchSize: 64,
    }
  },
})
