import IgniteClient from 'apache-ignite-client'
import type { Cursor } from 'apache-ignite-client'
import { CacheProviderError } from '@open-mercato/cache/provider'
import { IGNITE_PROVIDER_ID, type IgniteCacheProviderConfig } from './settings'

export type IgniteCacheCommands = {
  get(key: string): Promise<unknown>
  put(key: string, value: string): Promise<void>
  containsKey(key: string): Promise<boolean>
  removeKey(key: string): Promise<boolean>
  removeIfEquals(key: string, value: string): Promise<boolean>
}

type Session = {
  client: IgniteClient
  cache: ReturnType<IgniteClient['getCache']>
  alive: boolean
}

export type IgniteConnection = {
  readonly cacheName: string
  run<T>(operation: string, command: (cache: IgniteCacheCommands) => Promise<T>): Promise<T>
  scan(pageSize: number, visit: (key: string, raw: unknown) => Promise<void>): Promise<void>
  close(): Promise<void>
  isClosed(): boolean
}

const STATE_CONNECTED = 1
const RESET_ERROR_NAMES = new Set(['LostConnectionError', 'IllegalStateError'])

class DeadlineExceededError extends Error {
  constructor() {
    super('[internal] deadline exceeded')
    this.name = 'DeadlineExceededError'
  }
}

class ScanBudgetExceededError extends Error {
  constructor() {
    super('[internal] scan budget exceeded')
    this.name = 'ScanBudgetExceededError'
  }
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceededError()), ms)
  })
  return Promise.race([promise, deadline]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function errorName(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  const ctor = (error as { constructor?: { name?: unknown } }).constructor
  return typeof ctor?.name === 'string' ? ctor.name : ''
}

function requiresSessionReset(error: unknown): boolean {
  if (error instanceof DeadlineExceededError) return true
  if (RESET_ERROR_NAMES.has(errorName(error))) return true
  const message = error instanceof Error ? error.message : ''
  return /cache does not exist|cache .* not found|not started|connection/i.test(message)
}

type TransportHolder = { _socket?: { _socket?: { _socket?: { destroy?: () => void } | null } | null } | null }

function attempt(action: () => void): void {
  try {
    action()
  } catch {
    return
  }
}

function forceCloseTransport(client: IgniteClient): void {
  const transport = (client as unknown as TransportHolder)._socket?._socket?._socket
  attempt(() => client.disconnect())
  attempt(() => transport?.destroy?.())
}

function buildClientConfiguration(config: IgniteCacheProviderConfig) {
  const clientConfig = new IgniteClient.IgniteClientConfiguration(...config.endpoints)
  if (config.username !== undefined && config.password !== undefined) {
    clientConfig.setUserName(config.username).setPassword(config.password)
  }
  if (config.tls) {
    clientConfig.setConnectionOptions(true, {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: config.tls.rejectUnauthorized,
      ...(config.tls.ca !== undefined ? { ca: config.tls.ca } : {}),
      ...(config.tls.cert !== undefined ? { cert: config.tls.cert } : {}),
      ...(config.tls.key !== undefined ? { key: config.tls.key } : {}),
      ...(config.tls.servername !== undefined ? { servername: config.tls.servername } : {}),
    })
  } else {
    clientConfig.setConnectionOptions(false, { noDelay: true })
  }
  return clientConfig
}

export function createIgniteConnection(config: IgniteCacheProviderConfig, cacheName: string): IgniteConnection {
  let session: Session | null = null
  let opening: Promise<Session> | null = null
  let closed = false
  const stringType = IgniteClient.ObjectType.PRIMITIVE_TYPE.STRING

  const unavailable = (operation: string, cause?: unknown) => new CacheProviderError(
    'unavailable',
    `Cache provider "${IGNITE_PROVIDER_ID}" could not complete ${operation} against Apache Ignite`,
    { providerId: IGNITE_PROVIDER_ID, ...(cause !== undefined ? { cause } : {}) },
  )

  const timedOut = (operation: string, ms: number) => new CacheProviderError(
    'timeout',
    `Cache provider "${IGNITE_PROVIDER_ID}" ${operation} did not complete within ${ms}ms`,
    { providerId: IGNITE_PROVIDER_ID },
  )

  const discard = (target: Session) => {
    target.alive = false
    if (session === target) session = null
    forceCloseTransport(target.client)
  }

  const open = async (): Promise<Session> => {
    const holder: { session: Session | null } = { session: null }
    const client = new IgniteClient((state) => {
      if (state !== STATE_CONNECTED && holder.session) holder.session.alive = false
    })
    try {
      await withDeadline(client.connect(buildClientConfiguration(config)), config.connectTimeoutMs)
      const cache = config.createCache
        ? await withDeadline(client.getOrCreateCache(cacheName), config.connectTimeoutMs)
        : client.getCache(cacheName)
      if (!config.createCache) {
        const names = await withDeadline(client.cacheNames(), config.connectTimeoutMs)
        if (!names.includes(cacheName)) {
          throw new CacheProviderError(
            'unavailable',
            `Cache provider "${IGNITE_PROVIDER_ID}" requires a pre-created Ignite cache for this namespace (createCache is disabled)`,
            { providerId: IGNITE_PROVIDER_ID },
          )
        }
      }
      cache.setKeyType(stringType).setValueType(stringType)
      const created: Session = { client, cache, alive: true }
      holder.session = created
      return created
    } catch (error) {
      forceCloseTransport(client)
      if (error instanceof CacheProviderError) throw error
      if (error instanceof DeadlineExceededError) throw timedOut('connect', config.connectTimeoutMs)
      throw unavailable('connect', error)
    }
  }

  const acquire = async (): Promise<Session> => {
    if (closed) throw new CacheProviderError('unavailable', `Cache provider "${IGNITE_PROVIDER_ID}" connection is closed`, { providerId: IGNITE_PROVIDER_ID })
    if (session && session.alive) return session
    if (session && !session.alive) discard(session)
    if (!opening) {
      opening = open().then(
        (created) => {
          opening = null
          if (closed) {
            discard(created)
            throw new CacheProviderError('unavailable', `Cache provider "${IGNITE_PROVIDER_ID}" connection is closed`, { providerId: IGNITE_PROVIDER_ID })
          }
          session = created
          return created
        },
        (error: unknown) => {
          opening = null
          throw error
        },
      )
    }
    return opening
  }

  const failure = (target: Session, operation: string, error: unknown): Error => {
    if (requiresSessionReset(error)) discard(target)
    if (error instanceof CacheProviderError) return error
    if (error instanceof DeadlineExceededError) return timedOut(operation, config.commandTimeoutMs)
    return unavailable(operation, error)
  }

  const run = async <T>(operation: string, command: (cache: IgniteCacheCommands) => Promise<T>): Promise<T> => {
    const current = await acquire()
    try {
      return await withDeadline(command(current.cache), config.commandTimeoutMs)
    } catch (error) {
      throw failure(current, operation, error)
    }
  }

  const scan = async (pageSize: number, visit: (key: string, raw: unknown) => Promise<void>): Promise<void> => {
    const current = await acquire()
    const scanDeadline = Date.now() + config.scanTimeoutMs
    const pageDeadline = () => {
      const remaining = scanDeadline - Date.now()
      if (remaining <= 0) throw new ScanBudgetExceededError()
      return Math.min(config.commandTimeoutMs, remaining)
    }
    let cursor: Cursor | null = null
    let exhausted = false
    try {
      cursor = await withDeadline(current.cache.query(new IgniteClient.ScanQuery().setPageSize(pageSize)), pageDeadline())
      let entry = await withDeadline(cursor.getValue(), pageDeadline())
      while (entry) {
        const key = entry.getKey()
        if (typeof key === 'string') await visit(key, entry.getValue())
        entry = cursor.hasMore() ? await withDeadline(cursor.getValue(), pageDeadline()) : null
      }
      exhausted = true
    } catch (error) {
      if (error instanceof ScanBudgetExceededError) {
        throw new CacheProviderError(
          'timeout',
          `Cache provider "${IGNITE_PROVIDER_ID}" namespace scan did not complete within scanTimeoutMs (${config.scanTimeoutMs}ms)`,
          { providerId: IGNITE_PROVIDER_ID },
        )
      }
      throw failure(current, 'scan', error)
    } finally {
      if (cursor && !exhausted && current.alive) {
        await withDeadline(cursor.close(), config.commandTimeoutMs).catch(() => undefined)
      }
    }
  }

  const close = async (): Promise<void> => {
    closed = true
    const pendingOpen = opening
    if (pendingOpen) await pendingOpen.catch(() => undefined)
    if (session) discard(session)
  }

  return {
    cacheName,
    run,
    scan,
    close,
    isClosed: () => closed,
  }
}
