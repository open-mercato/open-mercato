import { Cluster, Redis } from 'ioredis'
import { GenericContainer, Wait } from 'testcontainers'
import type { StartedTestContainer } from 'testcontainers'
import { createRespSettingsSchema } from '../src/settings'
import type { RespClusterSettings } from '../src/settings'
import { ADMIN_PASSWORD, ADMIN_USER, APP_ACL_RULES, APP_USER, APP_PASSWORD, freePort } from './engine'

export type StartedValkeyCluster = {
  container: StartedTestContainer
  ports: number[]
  appSettings(overrides?: Partial<RespClusterSettings>): RespClusterSettings
  node(port: number): Redis
  adminCluster(): Cluster
  stop(): Promise<void>
}

export const CLUSTER_ACL_RULES = '+cluster|slots +cluster|shards +cluster|info'

const ACL = ['user default off', `user ${ADMIN_USER} on >${ADMIN_PASSWORD} ~* &* +@all`, `user ${APP_USER} ${APP_ACL_RULES} ${CLUSTER_ACL_RULES}`, ''].join('\n')

async function waitForClusterOk(ports: number[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const healthy = await Promise.all(ports.map(async (port) => {
      const client = new Redis({ host: '127.0.0.1', port, username: ADMIN_USER, password: ADMIN_PASSWORD, lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null })
      client.on('error', () => undefined)
      try {
        await client.connect()
        const info = String(await client.call('CLUSTER', 'INFO'))
        return info.includes('cluster_state:ok') && info.includes('cluster_known_nodes:3')
      } catch {
        return false
      } finally {
        client.disconnect()
      }
    }))
    if (healthy.every(Boolean)) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('[internal] valkey cluster did not reach cluster_state:ok')
}

/**
 * Three Valkey primaries (separate valkey-server processes, 0 replicas) in one
 * container, announced on 127.0.0.1 with identical host and container ports so
 * MOVED/ASK redirects point at addresses reachable from the test process.
 */
export async function startValkeyCluster(image = 'valkey/valkey:8.1'): Promise<StartedValkeyCluster> {
  const ports = [await freePort(), await freePort(), await freePort()]
  const startNodes = ports.map((port) => `valkey-server --port ${port} --cluster-enabled yes --cluster-config-file /data/nodes-${port}.conf --cluster-announce-ip 127.0.0.1 --cluster-node-timeout 5000 --save '' --appendonly no --aclfile /om/users.acl --daemonize yes --logfile /data/node-${port}.log`).join(' && ')
  const create = `valkey-cli --user ${ADMIN_USER} --pass ${ADMIN_PASSWORD} --no-auth-warning --cluster create ${ports.map((port) => `127.0.0.1:${port}`).join(' ')} --cluster-replicas 0 --cluster-yes`
  const script = `${startNodes} && sleep 1 && ${create} && echo CLUSTER-CREATED && tail -f /dev/null`
  const container = await new GenericContainer(image)
    .withEntrypoint(['sh', '-c'])
    .withCommand([script])
    .withCopyContentToContainer([{ content: ACL, target: '/om/users.acl', mode: 0o644 }])
    .withExposedPorts(...ports.map((port) => ({ container: port, host: port })))
    .withWaitStrategy(Wait.forLogMessage(/CLUSTER-CREATED/))
    .withStartupTimeout(120_000)
    .start()
  await waitForClusterOk(ports, 60_000)
  const schema = createRespSettingsSchema()
  return {
    container,
    ports,
    appSettings(overrides = {}) {
      const parsed = schema.parse({
        mode: 'cluster',
        nodes: ports.map((port) => ({ host: '127.0.0.1', port })),
        username: APP_USER,
        password: APP_PASSWORD,
        connectTimeoutMs: 5_000,
        commandTimeoutMs: 5_000,
        maxRetriesPerRequest: 3,
        ...overrides,
      })
      if (parsed.mode !== 'cluster') throw new Error('[internal] expected cluster settings')
      return parsed
    },
    node(port) {
      const client = new Redis({ host: '127.0.0.1', port, username: ADMIN_USER, password: ADMIN_PASSWORD, maxRetriesPerRequest: 2 })
      client.on('error', () => undefined)
      return client
    },
    adminCluster() {
      const client = new Cluster(ports.map((port) => ({ host: '127.0.0.1', port })), { redisOptions: { username: ADMIN_USER, password: ADMIN_PASSWORD } })
      client.on('error', () => undefined)
      return client
    },
    async stop() {
      await container.stop({ remove: true })
    },
  }
}
