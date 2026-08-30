import { monitorEventLoopDelay, performance, type EventLoopUtilization } from 'node:perf_hooks'
import { getHeapSpaceStatistics } from 'node:v8'
import {
  collectTelemetryMetrics,
  recordTelemetryMetric,
} from '@open-mercato/shared/lib/telemetry/runtime'
import { createLogger } from '@open-mercato/shared/lib/logger'

const SAMPLE_INTERVAL_MS = 10_000
const DELAY_RESOLUTION_MS = 20
const NANOSECONDS_PER_SECOND = 1_000_000_000
const GLOBAL_KEY = Symbol.for('@open-mercato/telemetry.runtimeMetrics')

export type EventLoopDelayMonitor = {
  enable(): void
  disable(): void
  percentile(percentile: number): number
  reset(): void
}

export type HeapSpaceSample = {
  space_name: string
  space_used_size: number
}

export type RuntimeMetricSources = {
  createEventLoopDelayMonitor(): EventLoopDelayMonitor
  eventLoopUtilization(
    first?: EventLoopUtilization,
    second?: EventLoopUtilization,
  ): EventLoopUtilization
  memoryUsage(): { rss: number }
  heapSpaceStatistics(): HeapSpaceSample[]
  setInterval(handler: () => void, intervalMs: number): ReturnType<typeof setInterval>
  clearInterval(interval: ReturnType<typeof setInterval>): void
}

type ActiveRuntimeSampler = {
  references: number
  dispose(): void
}

type RuntimeMetricsStore = {
  active?: ActiveRuntimeSampler
}

const logger = createLogger('telemetry').child({ component: 'runtime-metrics' })

const defaultSources: RuntimeMetricSources = {
  createEventLoopDelayMonitor: () => monitorEventLoopDelay({ resolution: DELAY_RESOLUTION_MS }),
  eventLoopUtilization: (first, second) => performance.eventLoopUtilization(first, second),
  memoryUsage: () => process.memoryUsage(),
  heapSpaceStatistics: () => getHeapSpaceStatistics(),
  setInterval: (handler, intervalMs) => setInterval(handler, intervalMs),
  clearInterval: (interval) => clearInterval(interval),
}

function store(): RuntimeMetricsStore {
  const globalStore = globalThis as unknown as Record<symbol, RuntimeMetricsStore | undefined>
  let current = globalStore[GLOBAL_KEY]
  if (!current) {
    current = {}
    globalStore[GLOBAL_KEY] = current
  }
  return current
}

function secondsFromNanoseconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) / NANOSECONDS_PER_SECOND : 0
}

export function createRuntimeMetricsSampler(
  sources: RuntimeMetricSources = defaultSources,
): () => void {
  const delay = sources.createEventLoopDelayMonitor()
  let previousUtilization = sources.eventLoopUtilization()
  delay.enable()

  const sample = () => {
    try {
      const currentUtilization = sources.eventLoopUtilization()
      const intervalUtilization = sources.eventLoopUtilization(
        currentUtilization,
        previousUtilization,
      )
      previousUtilization = currentUtilization

      recordTelemetryMetric({
        kind: 'gauge',
        name: 'nodejs.eventloop.utilization',
        value: intervalUtilization.utilization,
        unit: '1',
      })
      for (const percentile of [50, 90, 99]) {
        recordTelemetryMetric({
          kind: 'gauge',
          name: `nodejs.eventloop.delay.p${percentile}`,
          value: secondsFromNanoseconds(delay.percentile(percentile)),
          unit: 's',
        })
      }

      recordTelemetryMetric({
        kind: 'gauge',
        name: 'process.memory.usage',
        value: sources.memoryUsage().rss,
        unit: 'By',
      })
      for (const heapSpace of sources.heapSpaceStatistics()) {
        recordTelemetryMetric({
          kind: 'gauge',
          name: 'v8js.memory.heap.used',
          value: heapSpace.space_used_size,
          labels: { 'v8js.heap.space.name': heapSpace.space_name },
          unit: 'By',
        })
      }

      collectTelemetryMetrics()
      delay.reset()
    } catch (err) {
      logger.warn('Runtime metric sampling failed', { err })
    }
  }

  const interval = sources.setInterval(sample, SAMPLE_INTERVAL_MS)
  interval.unref?.()

  return () => {
    sources.clearInterval(interval)
    delay.disable()
  }
}

export function startRuntimeMetrics(): () => void {
  const current = store()
  if (!current.active) {
    current.active = {
      references: 0,
      dispose: createRuntimeMetricsSampler(),
    }
  }

  const active = current.active
  active.references += 1
  let released = false

  return () => {
    if (released) return
    released = true
    active.references -= 1
    if (active.references > 0) return
    active.dispose()
    const latest = store()
    if (latest.active === active) latest.active = undefined
  }
}

/** Test-only: tear down the process-wide sampler regardless of reference count. */
export function resetRuntimeMetrics(): void {
  const current = store()
  current.active?.dispose()
  current.active = undefined
}
