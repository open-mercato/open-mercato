import type { EventStrategy } from '../types'

type RedisClient = any

export function createRedisStrategy(url = process.env.REDIS_URL || process.env.EVENTS_REDIS_URL, deliver?: (event: string, payload: any) => Promise<void>): EventStrategy {
  if (!url) throw new Error('REDIS_URL or EVENTS_REDIS_URL must be set for redis events strategy')
  let Redis: any
  try {
    Redis = require('ioredis')
  } catch (e1) {
    try {
      Redis = require('redis')
    } catch (e2) {
      throw new Error('Install "ioredis" or "redis" to use redis strategy')
    }
  }
  const client: RedisClient = Redis.createClient ? Redis.createClient({ url }) : new Redis(url)
  const ready = (async () => { if (client.connect) await client.connect() })()

  const keyQueue = 'events:queue'
  const keyLastId = 'events:last_id'
  const keyProcessed = 'events:last_processed_id'

  async function emit(evt: { event: string; payload: any; persistent?: boolean; createdAt?: string }) {
    await ready
    if (deliver) await deliver(evt.event, evt.payload)
    if (!evt.persistent) return
    const id = client.incr ? await client.incr(keyLastId) : await client.incr(keyLastId)
    const createdAt = evt.createdAt || new Date().toISOString()
    const value = JSON.stringify({ id, event: evt.event, payload: evt.payload, persistent: true, createdAt })
    if (client.zAdd) await client.zAdd(keyQueue, [{ score: id, value }])
    else if (client.zadd) await client.zadd(keyQueue, id, value)
    else throw new Error('Redis client does not support zadd')
  }

  async function processOffline(opts?: { limit?: number }) {
    await ready
    const lastProcessedRaw = client.get ? await client.get(keyProcessed) : await client.get(keyProcessed)
    const lastProcessed = Number(lastProcessedRaw || 0)
    const limit = opts?.limit ?? 1000
    let items: string[] = []
    if (client.zRangeByScore) items = await client.zRangeByScore(keyQueue, lastProcessed + 0.000001, '+inf', { BY: 'SCORE', LIMIT: { offset: 0, count: limit } })
    else if (client.zrangebyscore) items = await client.zrangebyscore(keyQueue, `(${lastProcessed}`, '+inf', 'LIMIT', 0, limit)
    else throw new Error('Redis client does not support zrangebyscore')
    let processed = 0
    let newLast = lastProcessed
    for (const raw of items) {
      try {
        const entry = JSON.parse(raw) as { id: number; event: string; payload: any }
        if (deliver) await deliver(entry.event, entry.payload)
        newLast = entry.id
        processed++
      } catch (err) {
        console.error('Failed to process event from Redis queue:', { error: err, raw });
      }
    }
    if (newLast !== lastProcessed) {
      if (client.set) await client.set(keyProcessed, String(newLast))
      else await client.set(keyProcessed, String(newLast))
    }
    return { processed, lastId: newLast }
  }

  async function clearQueue() {
    await ready
    let removed = 0
    if (client.zRemRangeByScore) removed = await client.zRemRangeByScore(keyQueue, '-inf', '+inf')
    else if (client.zremrangebyscore) removed = await client.zremrangebyscore(keyQueue, '-inf', '+inf')
    else throw new Error('Redis client does not support zremrangebyscore')
    return { removed }
  }

  async function clearProcessed() {
    await ready
    const lastProcessedRaw = client.get ? await client.get(keyProcessed) : await client.get(keyProcessed)
    const lastProcessed = Number(lastProcessedRaw || 0)
    let removed = 0
    if (client.zRemRangeByScore) removed = await client.zRemRangeByScore(keyQueue, '-inf', lastProcessed)
    else if (client.zremrangebyscore) removed = await client.zremrangebyscore(keyQueue, '-inf', lastProcessed)
    else throw new Error('Redis client does not support zremrangebyscore')
    return { removed, lastId: lastProcessed }
  }

  function on(_event: string, _handler: any) {}
  function registerModuleSubscribers(_subs: any[]) {}

  return { emit, on, registerModuleSubscribers, processOffline, clearQueue, clearProcessed }
}
