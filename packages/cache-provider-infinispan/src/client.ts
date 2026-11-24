import { CacheProviderError } from '@open-mercato/cache/provider'
import type { InfinispanSettings } from './settings'

export const PROVIDER_ID = 'open-mercato/infinispan'

export type HotRodMetadataValue = {
  value: string
  version: Buffer
}

export type HotRodStoreOptions = {
  lifespan?: string
}

export type HotRodIteratorStep = {
  done: boolean
  key?: unknown
  value?: unknown
  version?: unknown
}

export type HotRodIterator = {
  next(): Promise<HotRodIteratorStep>
  close(): Promise<unknown>
}

export type HotRodClient = {
  get(key: string): Promise<string | undefined>
  getWithMetadata(key: string): Promise<HotRodMetadataValue | undefined>
  getAll(keys: string[]): Promise<Array<{ key: string; value: string }>>
  containsKey(key: string): Promise<boolean>
  put(key: string, value: string, options?: HotRodStoreOptions): Promise<unknown>
  putIfAbsent(key: string, value: string, options?: HotRodStoreOptions): Promise<boolean>
  replaceWithVersion(key: string, value: string, version: Buffer, options?: HotRodStoreOptions): Promise<boolean>
  remove(key: string): Promise<boolean>
  removeWithVersion(key: string, version: Buffer): Promise<boolean>
  iterator(batchSize: number, options?: { metadata?: boolean }): Promise<HotRodIterator>
  disconnect(): Promise<void>
}

export type HotRodServerAddress = { host: string; port: number }

export type HotRodClientOptions = {
  version: string
  cacheName: string
  topologyUpdates: boolean
  maxRetries: number
  authentication: {
    enabled: true
    saslMechanism: string
    userName: string
    password: string
  }
  ssl?: {
    enabled: true
    trustCerts: string[]
    sniHostName?: string
  }
  dataFormat: { keyType: 'text/plain'; valueType: 'text/plain' }
}

export type HotRodConnector = (servers: HotRodServerAddress[], options: HotRodClientOptions) => Promise<HotRodClient>

type HotRodModule = { client: HotRodConnector }

function isHotRodModule(value: unknown): value is HotRodModule {
  return typeof value === 'object' && value !== null && typeof (value as { client?: unknown }).client === 'function'
}

export async function loadHotRodConnector(): Promise<HotRodConnector> {
  const imported: unknown = await import('infinispan')
  const candidates = [imported, (imported as { default?: unknown }).default]
  const module = candidates.find(isHotRodModule)
  if (!module) {
    throw new CacheProviderError('load_failed', `Cache provider "${PROVIDER_ID}" could not load the infinispan Hot Rod client`, { providerId: PROVIDER_ID })
  }
  return (servers, options) => module.client(servers, options)
}

export function buildHotRodClientOptions(config: InfinispanSettings): HotRodClientOptions {
  return {
    version: config.protocolVersion,
    cacheName: config.cacheName,
    topologyUpdates: config.topologyUpdates,
    maxRetries: Math.max(1, config.servers.length),
    authentication: {
      enabled: true,
      saslMechanism: config.auth.mechanism,
      userName: config.auth.username,
      password: config.auth.password,
    },
    ...(config.tls
      ? {
        ssl: {
          enabled: true as const,
          trustCerts: [...config.tls.caFiles],
          ...(config.tls.serverName ? { sniHostName: config.tls.serverName } : {}),
        },
      }
      : {}),
    dataFormat: { keyType: 'text/plain', valueType: 'text/plain' },
  }
}

export type HotRodGateway = {
  run<T>(operation: string, body: (client: HotRodClient) => Promise<T>): Promise<T>
  scan(visit: (key: string, value: unknown, version: Buffer | null) => Promise<void> | void): Promise<void>
  connect(): Promise<void>
  close(): Promise<void>
}

export type HotRodGatewayOptions = {
  connector: HotRodConnector
  config: InfinispanSettings
}

const TIMEOUT_MARKER = Symbol('hotrod-timeout')

function unavailable(operation: string, cause?: unknown): CacheProviderError {
  return new CacheProviderError('unavailable', `Cache provider "${PROVIDER_ID}" ${operation} failed`, { providerId: PROVIDER_ID, cause })
}

function timedOut(operation: string, ms: number): CacheProviderError {
  return new CacheProviderError('timeout', `Cache provider "${PROVIDER_ID}" ${operation} did not complete within ${ms}ms`, { providerId: PROVIDER_ID })
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT_MARKER> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<typeof TIMEOUT_MARKER>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT_MARKER), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function disconnectQuietly(client: HotRodClient, ms: number): void {
  void withTimeout(client.disconnect().catch(() => undefined), ms).catch(() => undefined)
}

export function createHotRodGateway(options: HotRodGatewayOptions): HotRodGateway {
  const { connector, config } = options
  const clientOptions = buildHotRodClientOptions(config)
  const servers = config.servers.map((server) => ({ host: server.host, port: server.port }))
  let current: HotRodClient | null = null
  let connecting: Promise<HotRodClient> | null = null
  let closed = false

  const discard = (client: HotRodClient) => {
    if (current === client) current = null
    disconnectQuietly(client, config.commandTimeoutMs)
  }

  const acquire = async (): Promise<HotRodClient> => {
    if (closed) throw new CacheProviderError('unavailable', `Cache provider "${PROVIDER_ID}" is closed`, { providerId: PROVIDER_ID })
    if (current) return current
    if (!connecting) {
      const attempt = connector(servers, clientOptions)
      const guarded = withTimeout(attempt, config.connectTimeoutMs).then(
        (result) => {
          if (result === TIMEOUT_MARKER) {
            void attempt.then((late) => disconnectQuietly(late, config.commandTimeoutMs), () => undefined)
            throw timedOut('connect', config.connectTimeoutMs)
          }
          if (closed) {
            disconnectQuietly(result, config.commandTimeoutMs)
            throw new CacheProviderError('unavailable', `Cache provider "${PROVIDER_ID}" is closed`, { providerId: PROVIDER_ID })
          }
          current = result
          return result
        },
        (error: unknown) => {
          throw error instanceof CacheProviderError ? error : unavailable('connect', error)
        },
      )
      connecting = guarded
      guarded.then(
        () => { if (connecting === guarded) connecting = null },
        () => { if (connecting === guarded) connecting = null },
      )
    }
    return connecting
  }

  const run = async <T>(operation: string, body: (client: HotRodClient) => Promise<T>): Promise<T> => {
    const client = await acquire()
    let result: T | typeof TIMEOUT_MARKER
    try {
      result = await withTimeout(body(client), config.commandTimeoutMs)
    } catch (error) {
      discard(client)
      throw error instanceof CacheProviderError ? error : unavailable(operation, error)
    }
    if (result === TIMEOUT_MARKER) {
      discard(client)
      throw timedOut(operation, config.commandTimeoutMs)
    }
    return result
  }

  const scan = async (visit: (key: string, value: unknown, version: Buffer | null) => Promise<void> | void): Promise<void> => {
    const iterator = await run('iterator open', (client) => client.iterator(config.iteratorBatchSize, { metadata: true }))
    try {
      for (;;) {
        const step = await run('iterator next', () => iterator.next())
        if (step.done) break
        if (typeof step.key === 'string') await visit(step.key, step.value, Buffer.isBuffer(step.version) ? step.version : null)
      }
    } finally {
      await withTimeout(iterator.close().catch(() => undefined), config.commandTimeoutMs).catch(() => undefined)
    }
  }

  return {
    run,
    scan,
    async connect() {
      await acquire()
    },
    async close() {
      closed = true
      const client = current
      current = null
      const pending = connecting
      connecting = null
      if (pending) await pending.catch(() => undefined)
      if (client) await withTimeout(client.disconnect().catch(() => undefined), config.commandTimeoutMs).catch(() => undefined)
    },
  }
}
