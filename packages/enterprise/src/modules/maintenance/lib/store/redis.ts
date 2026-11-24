import { parseProcessRecord, parseStoredState, type MaintenanceProcessRecord, type MaintenanceStateV1 } from '../state'
import type { MaintenanceStateStore, StoredStateRead } from './types'

export const MAINTENANCE_STATE_KEY = 'om:maintenance:state'
export const MAINTENANCE_PROCESS_KEY_PREFIX = 'om:maintenance:proc:'

type RedisMulti = {
  set(key: string, value: string): RedisMulti
  exec(): Promise<Array<[Error | null, unknown]> | null>
}

/** Minimal surface of an ioredis client; ioredis stays an optional peer. */
export type RedisLike = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, mode?: string, ttl?: number): Promise<unknown>
  del(key: string): Promise<unknown>
  watch(key: string): Promise<unknown>
  unwatch(): Promise<unknown>
  multi(): RedisMulti
  scan(cursor: string, matchKeyword: 'MATCH', pattern: string, countKeyword: 'COUNT', count: number): Promise<[string, string[]]>
  mget(...keys: string[]): Promise<Array<string | null>>
  time(): Promise<[string, string]>
  info(section: string): Promise<string>
  config(subcommand: 'GET', parameter: string): Promise<unknown>
  quit(): Promise<unknown>
}

export function parseRedisDurability(info: string, saveConfig: unknown): boolean {
  if (/^aof_enabled:1\s*$/m.test(info)) return true
  if (Array.isArray(saveConfig) && saveConfig.length >= 2) {
    const value = String(saveConfig[1] ?? '').trim()
    return value.length > 0
  }
  return false
}

export function createRedisMaintenanceStore(
  client: RedisLike,
  options: { assumeDurable?: boolean } = {},
): MaintenanceStateStore {
  async function readState(): Promise<StoredStateRead> {
    const raw = await client.get(MAINTENANCE_STATE_KEY)
    if (raw === null) return { kind: 'missing' }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { kind: 'unsupported', reason: 'state value is not valid JSON' }
    }
    const result = parseStoredState(parsed)
    return result.kind === 'ok' ? { kind: 'ok', state: result.state } : result
  }

  return {
    kind: 'redis',
    multiHost: true,
    readState,
    async compareAndSet(expectedRevision: number, next: MaintenanceStateV1): Promise<boolean> {
      await client.watch(MAINTENANCE_STATE_KEY)
      try {
        const current = await readState()
        const currentRevision = current.kind === 'ok' ? current.state.revision : current.kind === 'missing' ? 0 : -1
        if (currentRevision !== expectedRevision) {
          await client.unwatch()
          return false
        }
        const result = await client.multi().set(MAINTENANCE_STATE_KEY, JSON.stringify(next)).exec()
        return result !== null
      } catch (error) {
        await client.unwatch().catch(() => {})
        throw error
      }
    },
    async writeProcess(record: MaintenanceProcessRecord, ttlMs: number): Promise<void> {
      await client.set(`${MAINTENANCE_PROCESS_KEY_PREFIX}${record.processId}`, JSON.stringify(record), 'PX', Math.max(1000, Math.floor(ttlMs)))
    },
    async removeProcess(processId: string): Promise<void> {
      await client.del(`${MAINTENANCE_PROCESS_KEY_PREFIX}${processId}`)
    },
    async listProcesses(): Promise<MaintenanceProcessRecord[]> {
      const keys: string[] = []
      let cursor = '0'
      do {
        const [nextCursor, batch] = await client.scan(cursor, 'MATCH', `${MAINTENANCE_PROCESS_KEY_PREFIX}*`, 'COUNT', 200)
        keys.push(...batch)
        cursor = nextCursor
      } while (cursor !== '0')
      if (keys.length === 0) return []
      const values = await client.mget(...keys)
      const records: MaintenanceProcessRecord[] = []
      for (const value of values) {
        if (!value) continue
        try {
          const record = parseProcessRecord(JSON.parse(value))
          if (record) records.push(record)
        } catch {
          continue
        }
      }
      return records
    },
    async now(): Promise<Date> {
      const [seconds, micros] = await client.time()
      return new Date(Number(seconds) * 1000 + Math.floor(Number(micros) / 1000))
    },
    async isDurable(): Promise<boolean> {
      if (options.assumeDurable) return true
      const info = await client.info('persistence')
      let saveConfig: unknown = null
      try {
        saveConfig = await client.config('GET', 'save')
      } catch {
        saveConfig = null
      }
      return parseRedisDurability(info, saveConfig)
    },
    async close(): Promise<void> {
      await client.quit().catch(() => {})
    },
  }
}
