import { rmSync } from 'node:fs'
import IgniteClient from 'apache-ignite-client'
import { defineCacheProviderConformance } from '@open-mercato/cache/testing/conformance'
import { igniteCacheName, type IgniteCacheProviderSettingsInput } from '../index'
import { buildConformanceChild } from './support/build-child'
import { containerTestsEnabled, startIgnite, type StartedIgnite } from './support/ignite-container'
import { createIgniteService, spawnIgniteChild } from './support/service'

const describeContainer = containerTestsEnabled ? describe : describe.skip

let ignite: Pick<StartedIgnite, 'endpoint'> & { container?: StartedIgnite['container'] } | null = null
let childModule = ''

function settings(): IgniteCacheProviderSettingsInput {
  if (!ignite) throw new Error('[internal] Ignite container is not running')
  return { endpoints: [ignite.endpoint], scanPageSize: 128, connectTimeoutMs: 10_000, commandTimeoutMs: 10_000 }
}

async function writeRaw(namespace: string, key: string, raw: string): Promise<void> {
  const client = new IgniteClient()
  await client.connect(new IgniteClient.IgniteClientConfiguration(...settings().endpoints))
  try {
    const stringType = IgniteClient.ObjectType.PRIMITIVE_TYPE.STRING
    const cache = client.getCache(igniteCacheName('om-cache-', namespace)).setKeyType(stringType).setValueType(stringType)
    await cache.put(key, raw)
  } finally {
    client.disconnect()
  }
}

describeContainer('Apache Ignite 2.x cache provider (container)', () => {
  beforeAll(async () => {
    ignite = process.env.OM_IGNITE_ENDPOINT ? { endpoint: process.env.OM_IGNITE_ENDPOINT } : await startIgnite()
    childModule = await buildConformanceChild()
  }, 240_000)

  afterAll(async () => {
    if (childModule) rmSync(childModule, { force: true })
    await ignite?.container?.stop()
  }, 60_000)

  defineCacheProviderConformance({
    name: 'open-mercato/ignite (apacheignite/ignite:2.17.0-arm64, single node, no auth)',
    createService: (namespace, options) => createIgniteService(namespace, settings(), options),
    createIndependentProcess: (namespace) => spawnIgniteChild(childModule, namespace, settings()),
    corrupt: async ({ namespace, physicalKey }) => writeRaw(namespace, physicalKey, '{"v":1,"n":'),
    supportsReturnExpired: true,
  })
})
