import { createRequire } from 'node:module'
import { getRedisUrl, parseRedisUrl, REDIS_WIRE_PROTOCOL } from '@open-mercato/shared/lib/redis/connection'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { MaintenanceConfig } from '../config'
import { createFileMaintenanceStore } from './file'
import { createRedisMaintenanceStore, type RedisLike } from './redis'
import type { MaintenanceStateStore } from './types'

export type { MaintenanceStateStore, StoredStateRead } from './types'

export function resolveMaintenanceRedisUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.MAINTENANCE_REDIS_URL || getRedisUrl('QUEUE') || getRedisUrl('CACHE') || null
}

type ConnectingRedis = RedisLike & {
  status?: string
  once?(event: 'ready' | 'error' | 'end', listener: (error?: Error) => void): unknown
  off?(event: 'ready' | 'error' | 'end', listener: (error?: Error) => void): unknown
  disconnect?(): void
}

type RedisConstructor = new (options: Record<string, unknown>) => ConnectingRedis

const REDIS_READY_TIMEOUT_MS = 5000

/**
 * The client runs without an offline queue so a dead Redis fails fast, which also means any
 * command sent before the connection is ready is rejected. Wait for `ready` before handing out
 * the store so the first state read and heartbeat do not fail spuriously.
 */
export async function waitForRedisReady(client: ConnectingRedis, timeoutMs: number = REDIS_READY_TIMEOUT_MS): Promise<void> {
  if (client.status === undefined || client.status === 'ready') return
  if (typeof client.once !== 'function') return
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      client.off?.('ready', onReady)
      client.off?.('error', onError)
      client.off?.('end', onEnd)
    }
    const fail = (error: Error) => {
      cleanup()
      client.disconnect?.()
      reject(error)
    }
    const onReady = () => {
      cleanup()
      resolve()
    }
    const onError = (error?: Error) => fail(error ?? new Error('[internal] Maintenance Redis connection failed'))
    const onEnd = () => fail(new Error('[internal] Maintenance Redis connection closed before it became ready'))
    const timer = setTimeout(() => fail(new Error('[internal] Timed out connecting to the maintenance Redis store')), timeoutMs)
    client.once!('ready', onReady)
    client.once!('error', onError)
    client.once!('end', onEnd)
  })
}

function loadRedisConstructor(): RedisConstructor {
  const loaded = createRequire(`${process.cwd()}/package.json`)('ioredis') as {
    default?: RedisConstructor
    Redis?: RedisConstructor
  } & RedisConstructor
  const candidate = loaded.default ?? loaded.Redis ?? loaded
  if (typeof candidate !== 'function') throw new Error('[internal] ioredis is not installed; it is required for OM_MAINTENANCE_STORE=redis')
  return candidate
}

export async function createMaintenanceStore(config: MaintenanceConfig, env: NodeJS.ProcessEnv = process.env): Promise<MaintenanceStateStore> {
  const redisUrl = resolveMaintenanceRedisUrl(env)
  const useRedis = config.storeKind === 'redis' || (config.storeKind === 'auto' && !!redisUrl)
  if (!useRedis) return createFileMaintenanceStore(config.stateDir)
  if (!redisUrl) throw new Error('[internal] OM_MAINTENANCE_STORE=redis requires REDIS_URL (or MAINTENANCE_REDIS_URL)')
  const Redis = loadRedisConstructor()
  const client = new Redis({
    ...parseRedisUrl(redisUrl),
    protocol: REDIS_WIRE_PROTOCOL,
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
  })
  await waitForRedisReady(client)
  return createRedisMaintenanceStore(client, {
    assumeDurable: parseBooleanWithDefault(env.OM_MAINTENANCE_REDIS_ASSUME_DURABLE, false),
  })
}
