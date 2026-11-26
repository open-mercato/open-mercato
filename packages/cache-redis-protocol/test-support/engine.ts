import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Redis } from 'ioredis'
import type { RedisOptions } from 'ioredis'
import { GenericContainer, Wait } from 'testcontainers'
import type { StartedTestContainer } from 'testcontainers'
import type { RespStandaloneSettings } from '../src/settings'
import { createRespStandaloneSettingsSchema } from '../src/settings'

export const CONTAINER_TESTS_ENABLED = process.env.OM_CACHE_PROVIDER_CONTAINER_TESTS === '1'

export const describeContainers: jest.Describe = CONTAINER_TESTS_ENABLED ? describe : describe.skip

export type TlsMaterial = { ca: string; cert: string; key: string; otherCa: string }

export type RespEngineSpec = {
  image: string
  serverBinary: 'valkey-server' | 'redis-server' | 'keydb-server'
  tls: boolean
  extraArgs?: string[]
}

export const APP_USER = 'om-cache'
export const APP_PASSWORD = 'app-pass-7c1f0e2b9d'
export const ADMIN_USER = 'om-admin'
export const ADMIN_PASSWORD = 'admin-pass-41ad8e3c'
const CONTAINER_PORT = 6379

export const APP_ACL_RULES = `on >${APP_PASSWORD} ~om:* resetchannels -@all +@read +@write +@keyspace +@scripting +@transaction +@connection -@dangerous`

export type StartedRespEngine = {
  spec: RespEngineSpec
  container: StartedTestContainer
  host: string
  port: number
  tls: TlsMaterial | null
  appSettings(overrides?: Partial<RespStandaloneSettings>): RespStandaloneSettings
  adminOptions(): RedisOptions
  admin(): Redis
  restart(): Promise<void>
  stop(): Promise<void>
}

function openssl(args: string[], cwd: string): void {
  execFileSync('openssl', args, { cwd, stdio: 'pipe', timeout: 60_000 })
}

/**
 * Throwaway CA and a localhost node certificate (plus an unrelated CA for
 * negative tests). The certificate carries both serverAuth and clientAuth
 * EKUs so it also works on a TLS cluster bus, where each node presents it as
 * a client to its peers.
 */
export function generateTlsMaterial(): TlsMaterial {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'om-resp-tls-'))
  try {
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '2', '-subj', '/CN=om-cache-test-ca'], dir)
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

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

/**
 * A free host port in 20000-39999, so `port + 10000` (the cluster bus port)
 * stays a valid port number.
 */
export async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const port = 20_000 + Math.floor(Math.random() * 20_000)
    if (await isPortFree(port)) return port
  }
  throw new Error('[internal] no free port found')
}

function aclFile(): string {
  return [
    'user default off',
    `user ${ADMIN_USER} on >${ADMIN_PASSWORD} ~* &* +@all`,
    `user ${APP_USER} ${APP_ACL_RULES}`,
    '',
  ].join('\n')
}

async function waitForAdmin(options: RedisOptions, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = null
  while (Date.now() < deadline) {
    const client = new Redis({ ...options, lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null })
    client.on('error', () => undefined)
    try {
      await client.connect()
      if ((await client.ping()) === 'PONG') return
    } catch (error) {
      lastError = error
    } finally {
      client.disconnect()
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`[internal] RESP engine did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

/**
 * Start a pinned RESP engine with an ACL file (default user disabled, a
 * restricted app user fenced to `om:*`, an admin user for inspection) and,
 * optionally, TLS-only listening. The host port is fixed so a restart keeps it.
 */
export async function startRespEngine(spec: RespEngineSpec): Promise<StartedRespEngine> {
  const tls = spec.tls ? generateTlsMaterial() : null
  const hostPort = await freePort()
  const listenArgs = tls
    ? ['--port', '0', '--tls-port', String(CONTAINER_PORT), '--tls-cert-file', '/om/tls/server.crt', '--tls-key-file', '/om/tls/server.key', '--tls-ca-cert-file', '/om/tls/ca.crt', '--tls-auth-clients', 'no']
    : ['--port', String(CONTAINER_PORT)]
  const files = [{ content: aclFile(), target: '/om/users.acl', mode: 0o644 }]
  if (tls) {
    files.push(
      { content: tls.ca, target: '/om/tls/ca.crt', mode: 0o644 },
      { content: tls.cert, target: '/om/tls/server.crt', mode: 0o644 },
      { content: tls.key, target: '/om/tls/server.key', mode: 0o644 },
    )
  }
  const container = await new GenericContainer(spec.image)
    .withCommand([spec.serverBinary, ...listenArgs, '--save', '', '--appendonly', 'no', '--aclfile', '/om/users.acl', ...(spec.extraArgs ?? [])])
    .withCopyContentToContainer(files)
    .withExposedPorts({ container: CONTAINER_PORT, host: hostPort })
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(120_000)
    .start()
  const host = '127.0.0.1'
  const port = container.getMappedPort(CONTAINER_PORT)
  const tlsOptions = tls ? { ca: tls.ca, servername: 'localhost', rejectUnauthorized: true } : undefined
  const adminOptions = (): RedisOptions => ({
    host,
    port,
    username: ADMIN_USER,
    password: ADMIN_PASSWORD,
    ...(tlsOptions ? { tls: tlsOptions } : {}),
  })
  await waitForAdmin(adminOptions(), 60_000)
  const schema = createRespStandaloneSettingsSchema()
  return {
    spec,
    container,
    host,
    port,
    tls,
    appSettings(overrides = {}) {
      return schema.parse({
        host,
        port,
        username: APP_USER,
        password: APP_PASSWORD,
        ...(tls ? { tls: { ca: tls.ca, servername: 'localhost' } } : {}),
        connectTimeoutMs: 5_000,
        commandTimeoutMs: 5_000,
        ...overrides,
      })
    },
    adminOptions,
    admin() {
      const client = new Redis({ ...adminOptions(), maxRetriesPerRequest: 3 })
      client.on('error', () => undefined)
      return client
    },
    async restart() {
      await container.restart()
      await waitForAdmin(adminOptions(), 60_000)
    },
    async stop() {
      await container.stop({ remove: true })
    },
  }
}
