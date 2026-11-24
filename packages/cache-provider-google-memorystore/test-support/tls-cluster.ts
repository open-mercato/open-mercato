import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Cluster, Redis } from 'ioredis'
import type { RedisOptions } from 'ioredis'
import { GenericContainer, Wait } from 'testcontainers'
import type { StartedTestContainer } from 'testcontainers'
import {
  ADMIN_PASSWORD,
  ADMIN_USER,
  APP_ACL_RULES,
  APP_USER,
  freePort,
} from '@open-mercato/cache-redis-protocol/test-support/engine'
import type { TlsMaterial } from '@open-mercato/cache-redis-protocol/test-support/engine'
import { CLUSTER_ACL_RULES } from '@open-mercato/cache-redis-protocol/test-support/cluster'

export type StartedTlsValkeyCluster = {
  container: StartedTestContainer
  ports: number[]
  tls: TlsMaterial
  nodes: Redis[]
  admin: Cluster
  stop(): Promise<void>
}

const ACL = ['user default off', `user ${ADMIN_USER} on >${ADMIN_PASSWORD} ~* &* +@all`, `user ${APP_USER} ${APP_ACL_RULES} ${CLUSTER_ACL_RULES}`, ''].join('\n')

function openssl(args: string[], cwd: string): void {
  execFileSync('openssl', args, { cwd, stdio: 'pipe', timeout: 60_000 })
}

/**
 * Throwaway CA plus a node certificate valid for both serverAuth and
 * clientAuth: the TLS cluster bus is mutually authenticated, so each node
 * presents its certificate as a client to its peers.
 */
function generateClusterTlsMaterial(): TlsMaterial {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'om-gcp-tls-'))
  try {
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '2', '-subj', '/CN=om-cache-cluster-test-ca'], dir)
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'other.key', '-out', 'other.crt', '-days', '2', '-subj', '/CN=om-cache-other-ca'], dir)
    openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost'], dir)
    writeFileSync(path.join(dir, 'ext.cnf'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth,clientAuth\n')
    openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.crt', '-days', '2', '-extfile', 'ext.cnf'], dir)
    const read = (name: string) => readFileSync(path.join(dir, name), 'utf8')
    return { ca: read('ca.crt'), cert: read('server.crt'), key: read('server.key'), otherCa: read('other.crt') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function adminOptions(tls: TlsMaterial, port?: number): RedisOptions {
  return {
    host: '127.0.0.1',
    ...(port !== undefined ? { port } : {}),
    username: ADMIN_USER,
    password: ADMIN_PASSWORD,
    tls: { ca: tls.ca, servername: 'localhost', rejectUnauthorized: true },
  }
}

async function waitForClusterOk(ports: number[], tls: TlsMaterial, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const healthy = await Promise.all(ports.map(async (port) => {
      const client = new Redis({ ...adminOptions(tls, port), lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null })
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
  throw new Error('[internal] TLS valkey cluster did not reach cluster_state:ok')
}

/**
 * Three Valkey primaries speaking TLS only (client and cluster bus), an ACL
 * file with the default user disabled, announced on 127.0.0.1 so CLUSTER SLOTS
 * and MOVED/ASK redirects stay reachable. Stand-in for a Memorystore for
 * Valkey instance with cluster mode enabled and in-transit encryption.
 */
export async function startTlsValkeyCluster(image = 'valkey/valkey:8.1'): Promise<StartedTlsValkeyCluster> {
  const tls = generateClusterTlsMaterial()
  const ports = [await freePort(), await freePort(), await freePort()]
  const tlsArgs = '--tls-cert-file /om/tls/server.crt --tls-key-file /om/tls/server.key --tls-ca-cert-file /om/tls/ca.crt --tls-auth-clients no --tls-cluster yes --tls-replication yes'
  const startNodes = ports.map((port) => `valkey-server --port 0 --tls-port ${port} ${tlsArgs} --cluster-enabled yes --cluster-config-file /data/nodes-${port}.conf --cluster-announce-ip 127.0.0.1 --cluster-node-timeout 5000 --save '' --appendonly no --aclfile /om/users.acl --daemonize yes --logfile /data/node-${port}.log`).join(' && ')
  const create = `valkey-cli --tls --cacert /om/tls/ca.crt --sni localhost --user ${ADMIN_USER} --pass ${ADMIN_PASSWORD} --no-auth-warning --cluster create ${ports.map((port) => `127.0.0.1:${port}`).join(' ')} --cluster-replicas 0 --cluster-yes`
  const script = `${startNodes} && sleep 1 && ${create} && echo CLUSTER-CREATED && tail -f /dev/null`
  const container = await new GenericContainer(image)
    .withEntrypoint(['sh', '-c'])
    .withCommand([script])
    .withCopyContentToContainer([
      { content: ACL, target: '/om/users.acl', mode: 0o644 },
      { content: tls.ca, target: '/om/tls/ca.crt', mode: 0o644 },
      { content: tls.cert, target: '/om/tls/server.crt', mode: 0o644 },
      { content: tls.key, target: '/om/tls/server.key', mode: 0o644 },
    ])
    .withExposedPorts(...ports.map((port) => ({ container: port, host: port })))
    .withWaitStrategy(Wait.forLogMessage(/CLUSTER-CREATED/))
    .withStartupTimeout(120_000)
    .start()
  await waitForClusterOk(ports, tls, 60_000)
  const nodes = ports.map((port) => {
    const client = new Redis({ ...adminOptions(tls, port), maxRetriesPerRequest: 2 })
    client.on('error', () => undefined)
    return client
  })
  const admin = new Cluster(ports.map((port) => ({ host: '127.0.0.1', port })), { redisOptions: adminOptions(tls) })
  admin.on('error', () => undefined)
  return {
    container,
    ports,
    tls,
    nodes,
    admin,
    async stop() {
      admin.disconnect()
      for (const node of nodes) node.disconnect()
      await container.stop({ remove: true })
    },
  }
}
