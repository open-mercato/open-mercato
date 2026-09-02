import {
  registerTelemetryMetricCollector,
  registerTelemetryRuntime,
  resetTelemetryMetricCollectors,
  resetTelemetryRuntime,
  type TelemetryMetricPoint,
  type TelemetryRuntime,
} from '@open-mercato/shared/lib/telemetry/runtime'
import {
  createRuntimeMetricsSampler,
  resetRuntimeMetrics,
  startRuntimeMetrics,
  type EventLoopDelayMonitor,
  type RuntimeMetricSources,
} from '../runtime-metrics'
import type { EventLoopUtilization } from 'node:perf_hooks'

function createRuntime(recordMetric: (point: TelemetryMetricPoint) => void): TelemetryRuntime {
  return {
    canUseGlobalTracePropagation: () => false,
    captureTraceContext: () => ({}),
    continueTrace: (_carrier, _name, fn) => fn(),
    recordMetric,
    recordHttpDuration: () => {},
    reportError: () => {},
    shutdown: async () => {},
  }
}

describe('runtime metrics sampler', () => {
  afterEach(() => {
    resetRuntimeMetrics()
    resetTelemetryMetricCollectors()
    resetTelemetryRuntime()
  })

  it('records interval runtime values and invokes shared metric collectors', () => {
    const points: TelemetryMetricPoint[] = []
    registerTelemetryRuntime(createRuntime((point) => points.push(point)))
    const collectPool = jest.fn()
    registerTelemetryMetricCollector(collectPool)

    const delay: EventLoopDelayMonitor = {
      enable: jest.fn(),
      disable: jest.fn(),
      percentile: jest.fn((percentile) => percentile * 1_000_000),
      reset: jest.fn(),
    }
    const utilization: EventLoopUtilization[] = [
      { idle: 10, active: 10, utilization: 0.5 },
      { idle: 15, active: 25, utilization: 0.625 },
      { idle: 5, active: 15, utilization: 0.75 },
    ]
    let sample = () => {}
    const interval = { unref: jest.fn() } as unknown as ReturnType<typeof setInterval>
    const sources: RuntimeMetricSources = {
      createEventLoopDelayMonitor: () => delay,
      eventLoopUtilization: jest.fn(() => utilization.shift() ?? {
        idle: 0,
        active: 0,
        utilization: 0,
      }),
      memoryUsage: () => ({ rss: 123_456 }),
      heapSpaceStatistics: () => [{
        space_name: 'old_space',
        space_used_size: 78_900,
      }],
      setInterval: (handler, intervalMs) => {
        expect(intervalMs).toBe(10_000)
        sample = handler
        return interval
      },
      clearInterval: jest.fn(),
    }

    const dispose = createRuntimeMetricsSampler(sources)
    sample()

    expect(delay.enable).toHaveBeenCalledTimes(1)
    expect(interval.unref).toHaveBeenCalledTimes(1)
    expect(points).toEqual([
      {
        kind: 'gauge',
        name: 'nodejs.eventloop.utilization',
        value: 0.75,
        unit: '1',
      },
      {
        kind: 'gauge',
        name: 'nodejs.eventloop.delay.p50',
        value: 0.05,
        unit: 's',
      },
      {
        kind: 'gauge',
        name: 'nodejs.eventloop.delay.p90',
        value: 0.09,
        unit: 's',
      },
      {
        kind: 'gauge',
        name: 'nodejs.eventloop.delay.p99',
        value: 0.099,
        unit: 's',
      },
      {
        kind: 'gauge',
        name: 'process.memory.usage',
        value: 123_456,
        unit: 'By',
      },
      {
        kind: 'gauge',
        name: 'v8js.memory.heap.used',
        value: 78_900,
        labels: { 'v8js.heap.space.name': 'old_space' },
        unit: 'By',
      },
    ])
    expect(collectPool).toHaveBeenCalledTimes(1)
    expect(delay.reset).toHaveBeenCalledTimes(1)

    dispose()

    expect(sources.clearInterval).toHaveBeenCalledWith(interval)
    expect(delay.disable).toHaveBeenCalledTimes(1)
  })

  it('normalizes non-finite delay percentiles to zero', () => {
    const points: TelemetryMetricPoint[] = []
    registerTelemetryRuntime(createRuntime((point) => points.push(point)))
    let sample = () => {}
    const interval = { unref: jest.fn() } as unknown as ReturnType<typeof setInterval>
    const delay: EventLoopDelayMonitor = {
      enable: jest.fn(),
      disable: jest.fn(),
      percentile: () => Number.NaN,
      reset: jest.fn(),
    }
    const sources: RuntimeMetricSources = {
      createEventLoopDelayMonitor: () => delay,
      eventLoopUtilization: () => ({ idle: 0, active: 0, utilization: 0 }),
      memoryUsage: () => ({ rss: 0 }),
      heapSpaceStatistics: () => [],
      setInterval: (handler) => {
        sample = handler
        return interval
      },
      clearInterval: jest.fn(),
    }

    const dispose = createRuntimeMetricsSampler(sources)
    sample()
    dispose()

    expect(points.filter((point) => point.name.startsWith('nodejs.eventloop.delay.')))
      .toEqual([
        { kind: 'gauge', name: 'nodejs.eventloop.delay.p50', value: 0, unit: 's' },
        { kind: 'gauge', name: 'nodejs.eventloop.delay.p90', value: 0, unit: 's' },
        { kind: 'gauge', name: 'nodejs.eventloop.delay.p99', value: 0, unit: 's' },
      ])
  })

  it('resets delay state after a sampling-source failure and disposes once', () => {
    registerTelemetryRuntime(createRuntime(() => {}))
    let sample = () => {}
    const interval = { unref: jest.fn() } as unknown as ReturnType<typeof setInterval>
    const delay: EventLoopDelayMonitor = {
      enable: jest.fn(),
      disable: jest.fn(),
      percentile: () => 0,
      reset: jest.fn(),
    }
    const sources: RuntimeMetricSources = {
      createEventLoopDelayMonitor: () => delay,
      eventLoopUtilization: () => ({ idle: 0, active: 0, utilization: 0 }),
      memoryUsage: () => {
        throw new Error('[internal] memory sample failed')
      },
      heapSpaceStatistics: () => [],
      setInterval: (handler) => {
        sample = handler
        return interval
      },
      clearInterval: jest.fn(),
    }

    const dispose = createRuntimeMetricsSampler(sources)
    sample()
    dispose()
    dispose()

    expect(delay.reset).toHaveBeenCalledTimes(1)
    expect(delay.disable).toHaveBeenCalledTimes(1)
    expect(sources.clearInterval).toHaveBeenCalledTimes(1)
  })

  it('shares one process sampler until every owner releases it', () => {
    const interval = { unref: jest.fn() } as unknown as ReturnType<typeof setInterval>
    const delay: EventLoopDelayMonitor = {
      enable: jest.fn(),
      disable: jest.fn(),
      percentile: () => 0,
      reset: jest.fn(),
    }
    const sources: RuntimeMetricSources = {
      createEventLoopDelayMonitor: jest.fn(() => delay),
      eventLoopUtilization: () => ({ idle: 0, active: 0, utilization: 0 }),
      memoryUsage: () => ({ rss: 0 }),
      heapSpaceStatistics: () => [],
      setInterval: jest.fn(() => interval),
      clearInterval: jest.fn(),
    }

    const releaseFirst = startRuntimeMetrics(sources)
    const releaseSecond = startRuntimeMetrics(sources)

    expect(sources.createEventLoopDelayMonitor).toHaveBeenCalledTimes(1)
    expect(sources.setInterval).toHaveBeenCalledTimes(1)

    releaseFirst()
    expect(sources.clearInterval).not.toHaveBeenCalled()

    releaseSecond()
    releaseSecond()

    expect(sources.clearInterval).toHaveBeenCalledTimes(1)
    expect(delay.disable).toHaveBeenCalledTimes(1)
  })
})
