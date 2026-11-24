import { randomBytes } from 'node:crypto'
import type { Redis } from 'ioredis'
import type { CacheStrategy } from '@open-mercato/cache/types'

export type LatencySummary = { count: number; p50Ms: number; p95Ms: number; maxMs: number }

export type QualificationResult = {
  clients: number
  operationsPerClient: number
  payloadBytes: number
  tagPool: number
  keySpacePerClient: number
  durationMs: number
  logicalOpsPerSecond: number
  errors: number
  latency: { set: LatencySummary; get: LatencySummary; deleteByTags: LatencySummary }
  serverCommands: Record<string, number>
  serverCommandsPerLogicalOp: number
}

function summarize(samples: number[]): LatencySummary {
  if (samples.length === 0) return { count: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 }
  const sorted = [...samples].sort((left, right) => left - right)
  const pick = (quantile: number) => sorted[Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))]
  const round = (value: number) => Math.round(value * 1000) / 1000
  return { count: sorted.length, p50Ms: round(pick(0.5)), p95Ms: round(pick(0.95)), maxMs: round(sorted[sorted.length - 1]) }
}

function parseCommandStats(info: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const line of info.split(/\r?\n/)) {
    const match = /^cmdstat_([^:]+):calls=(\d+)/.exec(line)
    if (match) counts[match[1]] = Number(match[2])
  }
  return counts
}

async function timed(samples: number[], operation: () => Promise<unknown>): Promise<void> {
  const started = process.hrtime.bigint()
  await operation()
  samples.push(Number(process.hrtime.bigint() - started) / 1e6)
}

/**
 * Steady traffic with tag churn from independent service instances (separate
 * connections): every client writes tagged entries over a bounded key space,
 * reads random keys and invalidates a random tag every `invalidateEvery` ops.
 */
export async function runRespQualification(options: {
  open: () => Promise<CacheStrategy>
  admin: Redis
  clients?: number
  operationsPerClient?: number
  payloadBytes?: number
  tagPool?: number
  keySpacePerClient?: number
  invalidateEvery?: number
}): Promise<QualificationResult> {
  const clients = options.clients ?? 2
  const operationsPerClient = options.operationsPerClient ?? 2_000
  const payloadBytes = options.payloadBytes ?? 512
  const tagPool = options.tagPool ?? 25
  const keySpace = options.keySpacePerClient ?? 400
  const invalidateEvery = options.invalidateEvery ?? 20
  const payload = randomBytes(Math.ceil(payloadBytes / 2)).toString('hex').slice(0, payloadBytes)
  const services = await Promise.all(Array.from({ length: clients }, () => options.open()))
  const setSamples: number[] = []
  const getSamples: number[] = []
  const invalidateSamples: number[] = []
  let errors = 0
  const randomTag = () => `tag-${Math.floor(Math.random() * tagPool)}`

  try {
    for (const service of services) {
      for (let index = 0; index < keySpace; index += 1) await service.set(`warm:${index}`, payload, { tags: [randomTag()] })
    }
    await options.admin.call('CONFIG', 'RESETSTAT')
    const started = Date.now()
    await Promise.all(services.map(async (service, clientIndex) => {
      for (let operation = 0; operation < operationsPerClient; operation += 1) {
        const key = `perf:${clientIndex}:${Math.floor(Math.random() * keySpace)}`
        try {
          if (operation % invalidateEvery === invalidateEvery - 1) {
            await timed(invalidateSamples, () => service.deleteByTags([randomTag()]))
          } else if (operation % 2 === 0) {
            await timed(setSamples, () => service.set(key, { payload, operation }, { tags: [randomTag(), randomTag()], ttl: 60_000 }))
          } else {
            await timed(getSamples, () => service.get(key))
          }
        } catch {
          errors += 1
        }
      }
    }))
    const durationMs = Date.now() - started
    const serverCommands = parseCommandStats(String(await options.admin.call('INFO', 'commandstats')))
    const logicalOps = clients * operationsPerClient
    const totalCommands = Object.entries(serverCommands)
      .filter(([command]) => !['info', 'config', 'ping', 'auth', 'hello', 'client|setinfo', 'client'].includes(command))
      .reduce((sum, [, calls]) => sum + calls, 0)
    return {
      clients,
      operationsPerClient,
      payloadBytes,
      tagPool,
      keySpacePerClient: keySpace,
      durationMs,
      logicalOpsPerSecond: Math.round((logicalOps / durationMs) * 1000),
      errors,
      latency: { set: summarize(setSamples), get: summarize(getSamples), deleteByTags: summarize(invalidateSamples) },
      serverCommands,
      serverCommandsPerLogicalOp: Math.round((totalCommands / logicalOps) * 100) / 100,
    }
  } finally {
    for (const service of services) {
      await service.clear().catch(() => undefined)
      await service.close?.().catch(() => undefined)
    }
  }
}
