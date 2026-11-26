import { rmSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import IgniteClient from 'apache-ignite-client'
import { defineCacheProviderConformance, randomNamespace } from '@open-mercato/cache/testing/conformance'
import { igniteCacheName, type IgniteCacheProviderSettingsInput } from '../index'
import { buildConformanceChild } from './support/build-child'
import { containerTestsEnabled, startIgnite, type StartedIgnite } from './support/ignite-container'
import { createIgniteService, spawnIgniteChild } from './support/service'
import { createThrowawayTls, type ThrowawayTls } from './support/tls'

const describeContainer = containerTestsEnabled ? describe : describe.skip
const SUPERUSER = 'ignite'
const SUPERUSER_DEFAULT_PASSWORD = 'ignite'
const CACHE_USER = 'om_cache'
const CACHE_PASSWORD = `Om-${randomBytes(9).toString('hex')}`

let ignite: StartedIgnite | null = null
let tls: ThrowawayTls | null = null
let childModule = ''

function secureSettings(overrides: Partial<IgniteCacheProviderSettingsInput> = {}): IgniteCacheProviderSettingsInput {
  if (!ignite || !tls) throw new Error('[internal] secure Ignite container is not running')
  return {
    endpoints: [`localhost:${ignite.port}`],
    username: CACHE_USER,
    password: CACHE_PASSWORD,
    tls: { ca: tls.caPem },
    scanPageSize: 128,
    connectTimeoutMs: 10_000,
    commandTimeoutMs: 10_000,
    ...overrides,
  }
}

async function superuserClient(): Promise<IgniteClient> {
  if (!ignite || !tls) throw new Error('[internal] secure Ignite container is not running')
  const client = new IgniteClient()
  await client.connect(
    new IgniteClient.IgniteClientConfiguration(`localhost:${ignite.port}`)
      .setUserName(SUPERUSER)
      .setPassword(SUPERUSER_DEFAULT_PASSWORD)
      .setConnectionOptions(true, { ca: tls.caPem }),
  )
  return client
}

async function activateCluster(started: StartedIgnite, material: ThrowawayTls): Promise<void> {
  const script = [
    `keytool -importcert -noprompt -alias om-ca -file /opt/om-tls/ca.pem -keystore /tmp/om-trust.jks -storepass '${material.keystorePassword}'`,
    `cd /opt/ignite/apache-ignite && ./bin/control.sh --set-state ACTIVE --yes --user ${SUPERUSER} --password ${SUPERUSER_DEFAULT_PASSWORD} --host 127.0.0.1 --port 10800 --keystore /opt/om-tls/server.p12 --keystore-type PKCS12 --keystore-password '${material.keystorePassword}' --truststore /tmp/om-trust.jks --truststore-password '${material.keystorePassword}'`,
  ].join(' && ')
  const result = await started.container.exec(['bash', '-c', script])
  if (result.exitCode !== 0 || !/Cluster state changed to ACTIVE/.test(result.output)) {
    throw new Error(`[internal] could not activate the secure Ignite cluster (exit ${result.exitCode})`)
  }
}

async function createCacheUser(): Promise<void> {
  const client = await superuserClient()
  try {
    const bootstrap = await client.getOrCreateCache('om-cache-bootstrap')
    const sql = new (IgniteClient as unknown as { SqlFieldsQuery: new (sql: string) => { setSchema(schema: string): unknown } }).SqlFieldsQuery(
      `CREATE USER "${CACHE_USER}" WITH PASSWORD '${CACHE_PASSWORD}'`,
    )
    sql.setSchema('PUBLIC')
    const cursor = await (bootstrap as unknown as { query(query: unknown): Promise<{ getAll(): Promise<unknown> }> }).query(sql)
    await cursor.getAll()
    await client.destroyCache('om-cache-bootstrap')
  } finally {
    client.disconnect()
  }
}

async function writeRaw(namespace: string, key: string, raw: string): Promise<void> {
  const client = await superuserClient()
  try {
    const stringType = IgniteClient.ObjectType.PRIMITIVE_TYPE.STRING
    await client.getCache(igniteCacheName('om-cache-', namespace)).setKeyType(stringType).setValueType(stringType).put(key, raw)
  } finally {
    client.disconnect()
  }
}

describeContainer('Apache Ignite 2.x authenticated TLS profile (container)', () => {
  beforeAll(async () => {
    tls = createThrowawayTls()
    ignite = await startIgnite({
      configFile: 'ignite-secure-config.xml',
      env: { OM_IGNITE_KEYSTORE_PASSWORD: tls.keystorePassword, JVM_OPTS: '-Xms512m -Xmx512m -XX:MaxMetaspaceSize=256m' },
      extraFiles: [
        { source: tls.keystorePath, target: '/opt/om-tls/server.p12' },
        { source: path.join(tls.directory, 'ca.pem'), target: '/opt/om-tls/ca.pem' },
      ],
      readyPattern: /Topology snapshot \[ver=1, /,
    })
    await activateCluster(ignite, tls)
    await createCacheUser()
    childModule = await buildConformanceChild()
  }, 300_000)

  afterAll(async () => {
    if (childModule) rmSync(childModule, { force: true })
    await ignite?.container.stop()
    if (tls) rmSync(tls.directory, { recursive: true, force: true })
  }, 60_000)

  describe('negative transport and credential cases', () => {
    it('rejects a wrong password without echoing it', async () => {
      const wrong = `wrong-${randomBytes(6).toString('hex')}`
      const failure = await createIgniteService(randomNamespace('badpass'), secureSettings({ password: wrong }))
        .then((service) => service.get('x').finally(() => service.close!()))
        .catch((error: unknown) => error)
      expect(failure).toMatchObject({ name: 'CacheProviderError', code: 'unavailable' })
      expect((failure as Error).message).not.toContain(wrong)
      expect(JSON.stringify(failure)).not.toContain(wrong)
    }, 60_000)

    it('refuses a server certificate from an untrusted CA', async () => {
      const failure = await createIgniteService(randomNamespace('badca'), secureSettings({ tls: {} }))
        .then((service) => service.get('x').finally(() => service.close!()))
        .catch((error: unknown) => error)
      expect(failure).toMatchObject({ name: 'CacheProviderError', code: 'unavailable' })
    }, 60_000)

    it('fails a plaintext client against the TLS-only connector within the connect deadline', async () => {
      const started = Date.now()
      const failure = await createIgniteService(randomNamespace('plain'), secureSettings({ tls: undefined, connectTimeoutMs: 2_000 }))
        .then((service) => service.get('x').finally(() => service.close!()))
        .catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(Error)
      expect(Date.now() - started).toBeLessThan(15_000)
    }, 60_000)
  })

  defineCacheProviderConformance({
    name: 'open-mercato/ignite (apacheignite/ignite:2.17.0-arm64, single node, persistence, authentication, TLS)',
    createService: (namespace, options) => createIgniteService(namespace, secureSettings(), options),
    createIndependentProcess: (namespace) => spawnIgniteChild(childModule, namespace, secureSettings()),
    corrupt: async ({ namespace, physicalKey }) => writeRaw(namespace, physicalKey, 'not-a-record'),
    supportsReturnExpired: true,
  })
})
