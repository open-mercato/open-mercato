import { rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomNamespace } from '@open-mercato/cache/testing/conformance'
import { createCacheProviderHostContext, defineCacheProviderRegistration, resolveCacheProvider } from '@open-mercato/cache/provider'
import { buildRespKeyLayout } from '@open-mercato/cache-redis-protocol'
import { APP_PASSWORD, APP_USER, describeContainers } from '@open-mercato/cache-redis-protocol/test-support/engine'
import { defineManagedProviderPreflight } from '@open-mercato/cache-provider-managed-kit/testing/preflight'
import type { PreflightTarget } from '@open-mercato/cache-provider-managed-kit/testing/preflight'
import { PREFLIGHT_CREDENTIAL_FILE_ENV, preflightProviderFixture } from '@open-mercato/cache-provider-managed-kit/testing/file-credential'
import { createGoogleMemorystoreProvider } from '../index'
import { startTlsValkeyCluster } from '../../test-support/tls-cluster'
import type { StartedTlsValkeyCluster } from '../../test-support/tls-cluster'

let cluster: StartedTlsValkeyCluster | null = null

function settingsFor(target: PreflightTarget, tls?: { ca?: string; servername?: string }): Record<string, unknown> {
  const seed = target.nodes()[0]
  return {
    product: 'valkey',
    clusterMode: 'enabled',
    discoveryEndpoint: { host: '127.0.0.1', port: seed.options.port },
    auth: { kind: 'iam' },
    tls: { ca: tls?.ca ?? target.tls.ca, servername: tls?.servername ?? 'localhost' },
    connectTimeoutMs: 5_000,
    commandTimeoutMs: 5_000,
    batchSize: 64,
  }
}

const target = (): PreflightTarget => ({
  tls: cluster!.tls,
  nodes: () => cluster!.nodes,
  keyspace: () => cluster!.admin,
  async stop() {
    await cluster?.stop()
    cluster = null
  },
})

defineManagedProviderPreflight({
  label: 'valkey/valkey:8.1 · 3-primary cluster via discovery seed (cluster mode enabled stand-in) · rotating ACL credential as IAM token · TLS (client + bus)',
  packageDirName: 'cache-provider-google-memorystore',
  createProvider: (fixture) => createGoogleMemorystoreProvider(fixture) as never,
  packed: { packageName: '@open-mercato/cache-provider-google-memorystore', factoryExport: 'createGoogleMemorystoreProvider', registrationExport: 'googleMemorystoreCacheProviderRegistration' },
  async start() {
    cluster = await startTlsValkeyCluster()
    return target()
  },
  settings: settingsFor,
})

describeContainers('memorystore cluster-mode shard coverage (container preflight)', () => {
  jest.setTimeout(180_000)
  let local: StartedTlsValkeyCluster | null = null
  const provider = createGoogleMemorystoreProvider(preflightProviderFixture())

  beforeAll(async () => {
    process.env.OM_ENABLE_ENTERPRISE_MODULES = 'true'
    process.env.OM_ENABLE_ENTERPRISE_MODULES_CACHE_PROVIDERS = 'true'
    process.env[PREFLIGHT_CREDENTIAL_FILE_ENV] = path.join(os.tmpdir(), `om-shards-${process.pid}.json`)
    writeFileSync(process.env[PREFLIGHT_CREDENTIAL_FILE_ENV]!, JSON.stringify({ username: APP_USER, password: APP_PASSWORD }), { mode: 0o600 })
    local = await startTlsValkeyCluster()
  }, 600_000)

  afterAll(async () => {
    await local?.stop()
    rmSync(process.env[PREFLIGHT_CREDENTIAL_FILE_ENV]!, { force: true })
  }, 600_000)

  it('authenticates new connections on every shard discovered from the seed and fences each namespace to one hash slot', async () => {
    const shardTarget: PreflightTarget = { tls: local!.tls, nodes: () => local!.nodes, keyspace: () => local!.admin, stop: async () => undefined }
    const settings = settingsFor(shardTarget)
    const seed = local!.nodes[0]
    const ranges = (await seed.call('CLUSTER', 'SLOTS')) as Array<[number, number, [string, number]]>
    const ownerOf = (slot: number) => ranges.find(([start, end]) => slot >= start && slot <= end)![2][1]
    const byOwner = new Map<number, string>()
    while (byOwner.size < local!.ports.length) {
      const namespace = randomNamespace('shard')
      const valueSlot = Number(await seed.call('CLUSTER', 'KEYSLOT', buildRespKeyLayout(namespace).valueKey('k')))
      const tagSlot = Number(await seed.call('CLUSTER', 'KEYSLOT', buildRespKeyLayout(namespace).tagKey('t')))
      expect(tagSlot).toBe(valueSlot)
      if (!byOwner.has(ownerOf(valueSlot))) byOwner.set(ownerOf(valueSlot), namespace)
    }
    const strategies = await Promise.all([...byOwner.values()].map(async (namespace) => {
      const registration = defineCacheProviderRegistration({ id: provider.id, load: async () => provider, settings: () => settings })
      const resolved = await resolveCacheProvider([registration], { env: { CACHE_PROVIDER: provider.id, CACHE_PROVIDER_NAMESPACE: namespace } })
      return resolved!.definition.create(resolved!.config, createCacheProviderHostContext(resolved!))
    }))
    try {
      for (const [index, strategy] of strategies.entries()) {
        await strategy.set('k', index, { tags: ['t'] })
        expect(await strategy.get('k')).toBe(index)
      }
      for (const port of local!.ports) {
        const node = local!.nodes[local!.ports.indexOf(port)]
        expect(String(await node.call('CLIENT', 'LIST'))).toContain(`user=${APP_USER} `)
        expect(await node.dbsize()).toBeGreaterThan(0)
      }
    } finally {
      for (const strategy of strategies) {
        await strategy.clear()
        await strategy.close?.()
      }
    }
  })
})
