import { createServer } from 'node:net'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import https from 'node:https'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { GenericContainer, Network, Wait, type StartedNetwork, type StartedTestContainer } from 'testcontainers'
import infinispan from 'infinispan'
import type { TlsMaterial } from './tls'

export const INFINISPAN_IMAGE = 'quay.io/infinispan/server:15.2.6.Final'
export const ADMIN_USER = 'om-admin'
export const ADMIN_PASSWORD = 'om-admin-Secret-42'
export const DISTRIBUTED_CACHE_CONFIG = JSON.stringify({
  'distributed-cache': {
    mode: 'SYNC',
    owners: 1,
    statistics: true,
    encoding: { 'media-type': 'text/plain; charset=UTF-8' },
  },
})

export type InfinispanServerAddress = { host: string; port: number }

export type InfinispanCluster = {
  servers: InfinispanServerAddress[]
  containers: StartedTestContainer[]
  tls: TlsMaterial | null
  createCache(name: string): Promise<void>
  clusterMembers(): Promise<number>
  stop(): Promise<void>
}

const CONFIG_DIR = '/opt/infinispan/server/conf'

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

function tlsServerConfig(keystorePassword: string): string {
  const raw = execFileSync('docker', ['run', '--rm', '--entrypoint', 'cat', INFINISPAN_IMAGE, `${CONFIG_DIR}/infinispan.xml`], { encoding: 'utf8', timeout: 120_000 })
  const identities = `<server-identities><ssl><keystore path="server.p12" relative-to="infinispan.server.config.path" password="${keystorePassword}" alias="server"/></ssl></server-identities>`
  const patched = raw.replace(/<!-- Uncomment to enable TLS on the realm -->\s*<!-- server-identities>[\s\S]*?<\/server-identities-->/, identities)
  if (patched === raw) throw new Error('[internal] could not enable TLS in the stock Infinispan server configuration')
  return patched
}

export function hotRodAdminOptions(cluster: { tls: TlsMaterial | null }, cacheName?: string) {
  return {
    version: '4.1',
    topologyUpdates: false,
    ...(cacheName ? { cacheName } : {}),
    authentication: { enabled: true, saslMechanism: 'SCRAM-SHA-256', userName: ADMIN_USER, password: ADMIN_PASSWORD },
    ...(cluster.tls ? { ssl: { enabled: true, trustCerts: [cluster.tls.caFile], sniHostName: 'localhost' } } : {}),
  }
}

function restGet(server: InfinispanServerAddress, tls: TlsMaterial, route: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = https.request({
      host: server.host,
      port: server.port,
      path: route,
      method: 'GET',
      ca: readFileSync(tls.caFile),
      servername: 'localhost',
      auth: `${ADMIN_USER}:${ADMIN_PASSWORD}`,
      timeout: 10_000,
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => { body += chunk })
      response.on('end', () => resolve(body))
    })
    request.on('error', reject)
    request.on('timeout', () => request.destroy(new Error('[internal] REST request timed out')))
    request.end()
  })
}

export async function startInfinispanCluster(options: { nodes: number; tls: TlsMaterial | null; workDir: string; fixedPorts?: boolean }): Promise<InfinispanCluster> {
  const network: StartedNetwork = await new Network().start()
  const containers: StartedTestContainer[] = []
  let configFile: string | null = null
  if (options.tls) {
    configFile = path.join(options.workDir, 'infinispan-tls.xml')
    writeFileSync(configFile, tlsServerConfig(options.tls.keystorePassword))
  }
  try {
    for (let index = 0; index < options.nodes; index++) {
      let container = new GenericContainer(INFINISPAN_IMAGE)
        .withNetwork(network)
        .withNetworkAliases(`ispn${index + 1}`)
        .withEnvironment({
          USER: ADMIN_USER,
          PASS: ADMIN_PASSWORD,
          JAVA_OPTIONS: '-Xmx512m',
        })
        .withWaitStrategy(Wait.forLogMessage(/ISPN080001/))
        .withStartupTimeout(180_000)
      container = options.fixedPorts
        ? container.withExposedPorts({ container: 11222, host: await freePort() })
        : container.withExposedPorts(11222)
      if (options.tls && configFile) {
        container = container
          .withCopyFilesToContainer([
            { source: configFile, target: `${CONFIG_DIR}/infinispan-tls.xml`, mode: 0o644 },
            { source: options.tls.keystoreFile, target: `${CONFIG_DIR}/server.p12`, mode: 0o644 },
          ])
          .withCommand(['-c', 'infinispan-tls.xml'])
      }
      containers.push(await container.start())
    }
  } catch (error) {
    await Promise.all(containers.map((container) => container.stop().catch(() => undefined)))
    await network.stop().catch(() => undefined)
    throw error
  }
  const servers = containers.map((container) => ({ host: container.getHost(), port: container.getMappedPort(11222) }))
  const cluster: InfinispanCluster = {
    servers,
    containers,
    tls: options.tls,
    async createCache(name) {
      const admin = await infinispan.client(servers[0], hotRodAdminOptions(cluster))
      try {
        await admin.admin.getOrCreateCache(name, DISTRIBUTED_CACHE_CONFIG)
      } finally {
        await admin.disconnect()
      }
    },
    async clusterMembers() {
      if (!options.tls) throw new Error('[internal] clusterMembers requires the TLS profile (REST over HTTPS with BASIC auth)')
      const body = await restGet(servers[0], options.tls, '/rest/v2/container')
      const parsed = JSON.parse(body) as { cluster_members?: unknown[] }
      return Array.isArray(parsed.cluster_members) ? parsed.cluster_members.length : 0
    },
    async stop() {
      await Promise.all(containers.map((container) => container.stop({ timeout: 5_000 }).catch(() => undefined)))
      await network.stop().catch(() => undefined)
    },
  }
  return cluster
}

export async function waitFor(check: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`[internal] timed out waiting for ${label}`)
}
