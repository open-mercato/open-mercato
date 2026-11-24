import { Cluster, Redis } from 'ioredis'
import type { ClusterOptions, RedisOptions } from 'ioredis'
import type { RespSettings, RespTlsSettings } from './settings'
import { isClusterClient } from './cluster'

export type RespClient = Redis | Cluster

export type RespClientFactory = () => RespClient | Promise<RespClient>

export type RespCredentials = {
  username?: string
  password: string
}

/**
 * Supplies fresh credentials (for example a short-lived cloud access token).
 * Called before the first connection, on every reconnect and, with
 * `refreshIntervalMs`, periodically to re-authenticate live connections.
 */
export type RespCredentialsProvider = () => Promise<RespCredentials>

export type RespClientFactoryOptions = {
  credentialsProvider?: RespCredentialsProvider
  refreshIntervalMs?: number
  /** Extra ioredis options merged last (managed-service specifics such as `dnsLookup` or `natMap`). */
  redisOptions?: RedisOptions
  clusterOptions?: Omit<ClusterOptions, 'redisOptions'>
  onError?: (error: Error) => void
}

export type RespManagedClient = {
  client: RespClient
  /** Stop credential refresh timers; the strategy calls this on close. */
  dispose(): void
}

const RECONNECT_BASE_DELAY_MS = 100
const RECONNECT_MAX_DELAY_MS = 2_000

export function respReconnectDelay(attempt: number): number {
  return Math.min(RECONNECT_BASE_DELAY_MS * Math.max(1, attempt), RECONNECT_MAX_DELAY_MS)
}

function toTlsOptions(tls: RespTlsSettings | undefined): RedisOptions['tls'] {
  if (!tls) return undefined
  return {
    ...(tls.ca !== undefined ? { ca: tls.ca } : {}),
    ...(tls.cert !== undefined ? { cert: tls.cert } : {}),
    ...(tls.key !== undefined ? { key: tls.key } : {}),
    ...(tls.servername !== undefined ? { servername: tls.servername } : {}),
    rejectUnauthorized: tls.rejectUnauthorized,
  }
}

function baseRedisOptions(settings: RespSettings): RedisOptions {
  const tls = toTlsOptions(settings.tls)
  return {
    lazyConnect: true,
    connectTimeout: settings.connectTimeoutMs,
    commandTimeout: settings.commandTimeoutMs,
    maxRetriesPerRequest: settings.maxRetriesPerRequest,
    enableReadyCheck: false,
    autoResubscribe: false,
    retryStrategy: respReconnectDelay,
    ...(settings.username !== undefined ? { username: settings.username } : {}),
    ...(settings.password !== undefined ? { password: settings.password } : {}),
    ...(tls ? { tls } : {}),
  }
}

type CredentialTarget = { options: RedisOptions }

function applyCredentials(target: CredentialTarget, credentials: RespCredentials): void {
  target.options.username = credentials.username
  target.options.password = credentials.password
}

function credentialTargets(client: RespClient): CredentialTarget[] {
  if (isClusterClient(client)) {
    const nodes: CredentialTarget[] = client.nodes('all')
    const template = client.options.redisOptions
    return template ? [...nodes, { options: template }] : nodes
  }
  return [client]
}

async function reauthenticate(client: RespClient, credentials: RespCredentials): Promise<void> {
  const connections: Redis[] = isClusterClient(client) ? client.nodes('all') : [client]
  await Promise.all(connections.map(async (connection) => {
    if (connection.status !== 'ready') return
    if (credentials.username !== undefined) await connection.auth(credentials.username, credentials.password)
    else await connection.auth(credentials.password)
  }))
}

/**
 * Build a RESP client factory over ioredis for standalone or cluster settings.
 * Mutations and reads always go to primaries (`scaleReads: 'master'`).
 */
export function createIoredisClientFactory(settings: RespSettings, options: RespClientFactoryOptions = {}): () => Promise<RespManagedClient> {
  return async () => {
    const redisOptions: RedisOptions = { ...baseRedisOptions(settings), ...(options.redisOptions ?? {}) }
    if (options.credentialsProvider) applyCredentials({ options: redisOptions }, await options.credentialsProvider())

    const client: RespClient = settings.mode === 'cluster'
      ? new Cluster(settings.nodes.map((node) => ({ host: node.host, port: node.port })), {
        lazyConnect: true,
        scaleReads: 'master',
        enableOfflineQueue: true,
        maxRedirections: 16,
        retryDelayOnFailover: 100,
        retryDelayOnClusterDown: 100,
        retryDelayOnTryAgain: 100,
        slotsRefreshTimeout: settings.connectTimeoutMs,
        clusterRetryStrategy: respReconnectDelay,
        ...(options.clusterOptions ?? {}),
        redisOptions,
      })
      : new Redis({ ...redisOptions, host: settings.host, port: settings.port, db: settings.db })

    client.on('error', (error: Error) => options.onError?.(error))

    let refreshTimer: ReturnType<typeof setInterval> | null = null
    const provider = options.credentialsProvider
    if (provider) {
      const refresh = async (live: boolean) => {
        try {
          const credentials = await provider()
          for (const target of credentialTargets(client)) applyCredentials(target, credentials)
          if (live) await reauthenticate(client, credentials)
        } catch (error) {
          options.onError?.(error instanceof Error ? error : new Error('[internal] credential refresh failed'))
        }
      }
      client.on('reconnecting', () => {
        void refresh(false)
      })
      if (options.refreshIntervalMs !== undefined && options.refreshIntervalMs > 0) {
        refreshTimer = setInterval(() => {
          void refresh(true)
        }, options.refreshIntervalMs)
        refreshTimer.unref()
      }
    }

    return {
      client,
      dispose() {
        if (refreshTimer) clearInterval(refreshTimer)
        refreshTimer = null
      },
    }
  }
}
