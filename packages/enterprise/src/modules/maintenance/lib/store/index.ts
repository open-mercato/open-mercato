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

type RedisConstructor = new (options: Record<string, unknown>) => RedisLike

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
  return createRedisMaintenanceStore(client, {
    assumeDurable: parseBooleanWithDefault(env.OM_MAINTENANCE_REDIS_ASSUME_DURABLE, false),
  })
}
