import {
  startInProcessGenerateWatcher,
  type GenerateWatcherChangeSignal,
} from '../in-process-generate-watcher'
import { planGenerateWatchChanges } from '../generate-watch-plan'
import type { GenerateWatchCategory, GenerateWatchPlan, GenerateWatchSnapshot } from '../generate-watch-plan'
import { diffGenerateWatchStructureSnapshots } from '../generate-watch-structure'

const silentLogger = { log: jest.fn(), error: jest.fn() }

async function flushAsync(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}

function createFakeChangeSignal() {
  let version = 0
  let fallback = false
  let skippedTargets = false
  let discoverSkippedTargets = false
  const refresh = jest.fn(async () => {
    if (discoverSkippedTargets) {
      skippedTargets = false
      discoverSkippedTargets = false
    }
  })
  const signal: GenerateWatcherChangeSignal = {
    currentVersion: () => version,
    refresh,
    usesPollingFallback: () => fallback,
    hasSkippedTargets: () => skippedTargets,
    close: jest.fn(async () => undefined),
  }
  return {
    signal,
    markChanged: () => { version += 1 },
    markSkippedTarget: () => { skippedTargets = true },
    discoverSkippedTargetOnNextRefresh: () => { discoverSkippedTargets = true },
    usePollingFallback: () => { fallback = true },
  }
}

describe('startInProcessGenerateWatcher', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    silentLogger.log.mockReset()
    silentLogger.error.mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('runs the generator once on startup when skipInitial is false', async () => {
    const runGenerators = jest.fn(async () => undefined)
    const computeStructureChecksum = jest.fn(async () => 'checksum-a')

    const handle = startInProcessGenerateWatcher({
      pollMs: 1000,
      skipInitial: false,
      quiet: true,
      logger: silentLogger,
      computeStructureChecksum,
      runGenerators,
    })

    await flushAsync(8)

    expect(runGenerators).toHaveBeenCalledTimes(1)
    expect(runGenerators.mock.calls[0][0]).toBe('initial')

    await handle.close()
    await handle.done
  })

  it('skips the initial run when skipInitial is true', async () => {
    const runGenerators = jest.fn(async () => undefined)
    const computeStructureChecksum = jest.fn(async () => 'checksum-b')

    const handle = startInProcessGenerateWatcher({
      pollMs: 1000,
      skipInitial: true,
      quiet: true,
      logger: silentLogger,
      computeStructureChecksum,
      runGenerators,
    })

    await flushAsync(8)

    expect(runGenerators).not.toHaveBeenCalled()
    expect(computeStructureChecksum).toHaveBeenCalled()

    await handle.close()
    await handle.done
  })

  it('re-runs the generator when the checksum changes', async () => {
    let currentChecksum = 'stable'
    const runGenerators = jest.fn(async () => undefined)
    const computeStructureChecksum = jest.fn(async () => currentChecksum)

    const handle = startInProcessGenerateWatcher({
      pollMs: 1000,
      skipInitial: true,
      quiet: true,
      logger: silentLogger,
      computeStructureChecksum,
      runGenerators,
    })

    await flushAsync(8)
    expect(runGenerators).not.toHaveBeenCalled()

    // First tick: same checksum, no regeneration.
    jest.advanceTimersByTime(1000)
    await flushAsync(8)
    expect(runGenerators).not.toHaveBeenCalled()

    // Second tick: checksum changed, generator must run with 'structure change'.
    currentChecksum = 'changed'
    jest.advanceTimersByTime(1000)
    await flushAsync(8)
    expect(runGenerators).toHaveBeenCalledTimes(1)
    expect(runGenerators.mock.calls[0][0]).toBe('structure change')

    await handle.close()
    await handle.done
  })

  it('does not recompute the full checksum during event-gated idle polls', async () => {
    const runGenerators = jest.fn(async () => undefined)
    const computeStructureChecksum = jest.fn(async () => 'stable')
    const { signal } = createFakeChangeSignal()
    const handle = startInProcessGenerateWatcher({
      pollMs: 1000,
      skipInitial: true,
      quiet: true,
      logger: silentLogger,
      changeSignal: signal,
      computeStructureChecksum,
      runGenerators,
    })

    await flushAsync(8)
    expect(computeStructureChecksum).toHaveBeenCalledTimes(1)

    for (let poll = 0; poll < 20; poll += 1) {
      jest.advanceTimersByTime(1000)
      await flushAsync(8)
    }

    expect(computeStructureChecksum).toHaveBeenCalledTimes(1)
    expect(runGenerators).not.toHaveBeenCalled()
    await handle.close()
  })

  it('discovers skipped roots during event-gated idle polling', async () => {
    const runGenerators = jest.fn(async () => undefined)
    const computeStructureChecksum = jest.fn()
      .mockResolvedValueOnce('before')
      .mockResolvedValue('after')
    const {
      signal,
      markSkippedTarget,
      discoverSkippedTargetOnNextRefresh,
    } = createFakeChangeSignal()
    markSkippedTarget()
    const handle = startInProcessGenerateWatcher({
      pollMs: 1000,
      skipInitial: true,
      quiet: true,
      logger: silentLogger,
      changeSignal: signal,
      computeStructureChecksum,
      runGenerators,
    })

    await flushAsync(8)
    expect(computeStructureChecksum).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(1000)
    await flushAsync(12)

    expect(signal.refresh).toHaveBeenCalledTimes(2)
    expect(computeStructureChecksum).toHaveBeenCalledTimes(1)
    discoverSkippedTargetOnNextRefresh()

    jest.advanceTimersByTime(1000)
    await flushAsync(12)

    expect(signal.refresh).toHaveBeenCalledTimes(3)
    expect(computeStructureChecksum).toHaveBeenCalledTimes(2)
    expect(runGenerators).toHaveBeenCalledWith('structure change')
    await handle.close()
  })

  it('coalesces filesystem event bursts into one checksum and regeneration', async () => {
    let currentChecksum = 'before'
    const runGenerators = jest.fn(async () => undefined)
    const computeStructureChecksum = jest.fn(async () => currentChecksum)
    const { signal, markChanged } = createFakeChangeSignal()
    const handle = startInProcessGenerateWatcher({
      pollMs: 1000,
      skipInitial: true,
      quiet: true,
      logger: silentLogger,
      changeSignal: signal,
      computeStructureChecksum,
      runGenerators,
    })

    await flushAsync(8)
    currentChecksum = 'after'
    markChanged()
    markChanged()
    markChanged()
    jest.advanceTimersByTime(1000)
    await flushAsync(12)

    expect(computeStructureChecksum).toHaveBeenCalledTimes(2)
    expect(runGenerators).toHaveBeenCalledTimes(1)
    expect(runGenerators).toHaveBeenCalledWith('structure change')
    await handle.close()
  })

  it('validates an unrelated filesystem event without regenerating', async () => {
    const runGenerators = jest.fn(async () => undefined)
    const computeStructureChecksum = jest.fn(async () => 'stable')
    const { signal, markChanged } = createFakeChangeSignal()
    const handle = startInProcessGenerateWatcher({
      pollMs: 1000,
      skipInitial: true,
      quiet: true,
      logger: silentLogger,
      changeSignal: signal,
      computeStructureChecksum,
      runGenerators,
    })

    await flushAsync(8)
    markChanged()
    jest.advanceTimersByTime(1000)
    await flushAsync(12)

    expect(computeStructureChecksum).toHaveBeenCalledTimes(2)
    expect(runGenerators).not.toHaveBeenCalled()
    await handle.close()
  })

  it('retries a dirty checksum after a transient checksum failure', async () => {
    const runGenerators = jest.fn(async () => undefined)
    const computeStructureChecksum = jest.fn()
      .mockResolvedValueOnce('before')
      .mockRejectedValueOnce(new Error('temporary read failure'))
      .mockResolvedValue('after')
    const { signal, markChanged } = createFakeChangeSignal()
    const handle = startInProcessGenerateWatcher({
      pollMs: 1000,
      skipInitial: true,
      quiet: true,
      logger: silentLogger,
      changeSignal: signal,
      computeStructureChecksum,
      runGenerators,
    })

    await flushAsync(8)
    markChanged()
    jest.advanceTimersByTime(1000)
    await flushAsync(8)
    expect(runGenerators).not.toHaveBeenCalled()

    jest.advanceTimersByTime(1000)
    await flushAsync(12)
    expect(computeStructureChecksum).toHaveBeenCalledTimes(3)
    expect(runGenerators).toHaveBeenCalledTimes(1)
    await handle.close()
  })

  it('keeps an event that arrives while a checksum is in flight dirty for the next poll', async () => {
    let releaseChecksum: ((value: string) => void) | null = null
    const runGenerators = jest.fn(async () => undefined)
    const computeStructureChecksum = jest.fn()
      .mockResolvedValueOnce('before')
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        releaseChecksum = resolve
      }))
      .mockResolvedValue('after')
    const { signal, markChanged } = createFakeChangeSignal()
    const handle = startInProcessGenerateWatcher({
      pollMs: 1000,
      skipInitial: true,
      quiet: true,
      logger: silentLogger,
      changeSignal: signal,
      computeStructureChecksum,
      runGenerators,
    })

    await flushAsync(8)
    markChanged()
    jest.advanceTimersByTime(1000)
    await flushAsync(8)
    expect(computeStructureChecksum).toHaveBeenCalledTimes(2)

    markChanged()
    releaseChecksum?.('after')
    await flushAsync(12)
    expect(runGenerators).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(1000)
    await flushAsync(12)
    expect(computeStructureChecksum).toHaveBeenCalledTimes(3)
    await handle.close()
  })

  it('falls back to full checksum polling when filesystem watching is unavailable', async () => {
    const runGenerators = jest.fn(async () => undefined)
    const computeStructureChecksum = jest.fn(async () => 'stable')
    const { signal, usePollingFallback } = createFakeChangeSignal()
    usePollingFallback()
    const handle = startInProcessGenerateWatcher({
      pollMs: 1000,
      skipInitial: true,
      quiet: true,
      logger: silentLogger,
      changeSignal: signal,
      computeStructureChecksum,
      runGenerators,
    })

    await flushAsync(8)
    jest.advanceTimersByTime(1000)
    await flushAsync(8)
    jest.advanceTimersByTime(1000)
    await flushAsync(8)

    expect(computeStructureChecksum).toHaveBeenCalledTimes(3)
    await handle.close()
    expect(signal.close).toHaveBeenCalledTimes(1)
  })

  it('does not start a new poll while a regeneration is in flight', async () => {
    let release: (() => void) | null = null
    const runGenerators = jest.fn(async (_reason: string) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
    })
    let currentChecksum = 'a'
    const computeStructureChecksum = jest.fn(async () => currentChecksum)

    const handle = startInProcessGenerateWatcher({
      pollMs: 1000,
      skipInitial: true,
      quiet: true,
      logger: silentLogger,
      computeStructureChecksum,
      runGenerators,
    })

    await flushAsync(8)
    // Establish baseline checksum, no run yet.
    expect(runGenerators).not.toHaveBeenCalled()

    // Tick #1: change checksum so a run starts and blocks.
    currentChecksum = 'b'
    jest.advanceTimersByTime(1000)
    await flushAsync(8)
    expect(runGenerators).toHaveBeenCalledTimes(1)

    // Single-shot scheduling must not overlap suites while the first is in flight.
    currentChecksum = 'c'
    jest.advanceTimersByTime(1000)
    await flushAsync(8)
    jest.advanceTimersByTime(1000)
    await flushAsync(8)
    expect(runGenerators).toHaveBeenCalledTimes(1)

    release?.()
    await flushAsync(20)

    await handle.close()
    await handle.done
  })

  it('logs but does not crash when the generator throws', async () => {
    const runGenerators = jest.fn(async () => {
      throw new Error('boom')
    })
    const computeStructureChecksum = jest.fn(async () => 'k')

    const handle = startInProcessGenerateWatcher({
      pollMs: 1000,
      skipInitial: false,
      quiet: true,
      logger: silentLogger,
      computeStructureChecksum,
      runGenerators,
    })

    await flushAsync(8)
    expect(runGenerators).toHaveBeenCalledTimes(1)
    expect(silentLogger.error).toHaveBeenCalled()
    const message = String(silentLogger.error.mock.calls[0][0] ?? '')
    expect(message).toMatch(/boom/)

    await handle.close()
    await handle.done
  })

  it('close() is idempotent and resolves done exactly once', async () => {
    const runGenerators = jest.fn(async () => undefined)
    const computeStructureChecksum = jest.fn(async () => 'k')

    const handle = startInProcessGenerateWatcher({
      pollMs: 1000,
      skipInitial: true,
      quiet: true,
      logger: silentLogger,
      computeStructureChecksum,
      runGenerators,
    })

    await flushAsync(8)
    await handle.close()
    await handle.close()
    await handle.done
    jest.advanceTimersByTime(5000)
    await flushAsync(12)
    expect(computeStructureChecksum).toHaveBeenCalledTimes(1)
    expect(runGenerators).not.toHaveBeenCalled()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((fulfill) => { resolve = fulfill })
  return { promise, resolve }
}

function snapshot(entries: Array<[string, GenerateWatchCategory, string]>): GenerateWatchSnapshot {
  return {
    checksum: JSON.stringify(entries),
    records: new Map(entries.map(([key, category, fingerprint]) => [
      key,
      { key, category, fingerprint, path: key },
    ])),
    fullReasons: [],
  }
}

describe('incremental generate watcher lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    silentLogger.log.mockReset()
    silentLogger.error.mockReset()
  })

  afterEach(() => { jest.useRealTimers() })

  function harness(skipInitial = true) {
    let current = snapshot([['api/item.ts', 'api-route', 'before']])
    const signalHarness = createFakeChangeSignal()
    const capture = jest.fn(async () => current)
    const plan = jest.fn((previous: GenerateWatchSnapshot, next: GenerateWatchSnapshot) =>
      planGenerateWatchChanges(diffGenerateWatchStructureSnapshots(previous, next), next.fullReasons))
    const runGenerators = jest.fn<Promise<void>, [string, GenerateWatchPlan?]>(async () => undefined)
    const computeStructureChecksum = jest.fn(() => { throw new Error('legacy capture must not run') })
    const options = {
      skipInitial,
      quiet: true,
      logger: silentLogger,
      pollMs: 250,
      computeStructureChecksum,
      changeSignal: signalHarness.signal,
      incremental: { capture, plan },
      runGenerators,
    }
    return {
      ...signalHarness,
      options,
      runGenerators,
      capture,
      plan,
      update: (next: GenerateWatchSnapshot) => { current = next; signalHarness.markChanged() },
    }
  }

  it('retries a failed partial suite as full without another event, even if input reverts', async () => {
    const h = harness()
    h.runGenerators.mockRejectedValueOnce(new Error('partial write'))
    const handle = startInProcessGenerateWatcher(h.options)
    await flushAsync(12)
    h.update(snapshot([['api/item.ts', 'api-route', 'after']]))
    jest.advanceTimersByTime(250)
    await flushAsync(16)
    expect(h.runGenerators.mock.calls[0][1]?.mode).toBe('incremental')
    // The candidate must not be acknowledged. A reverted tree can still have
    // partially updated outputs and therefore needs a full repair.
    h.capture.mockResolvedValue(snapshot([['api/item.ts', 'api-route', 'before']]))
    jest.advanceTimersByTime(250)
    await flushAsync(16)
    expect(h.runGenerators).toHaveBeenCalledTimes(2)
    expect(h.runGenerators.mock.calls[1][1]).toMatchObject({
      mode: 'full',
      reasons: expect.arrayContaining(['retry after failed generation']),
    })
    jest.advanceTimersByTime(250)
    await flushAsync(12)
    expect(h.runGenerators).toHaveBeenCalledTimes(2)
    await handle.close()
  })

  it('does not treat failed initial generation as a successful baseline', async () => {
    const h = harness(false)
    h.runGenerators.mockRejectedValueOnce(new Error('initial failed'))
    const handle = startInProcessGenerateWatcher(h.options)
    await flushAsync(16)
    jest.advanceTimersByTime(250)
    await flushAsync(16)
    expect(h.runGenerators.mock.calls.map(([, plan]) => plan?.mode)).toEqual(['full', 'full'])
    await handle.close()
  })

  it('preserves edits made during initial generation', async () => {
    const h = harness(false)
    const initial = deferred<void>()
    h.runGenerators.mockImplementationOnce(() => initial.promise)
    const handle = startInProcessGenerateWatcher(h.options)
    await flushAsync(12)
    h.update(snapshot([
      ['api/item.ts', 'api-route', 'before'],
      ['di.ts', 'di', 'new'],
    ]))
    jest.advanceTimersByTime(1000)
    await flushAsync(12)
    expect(h.runGenerators).toHaveBeenCalledTimes(1)
    initial.resolve()
    await flushAsync(16)
    jest.advanceTimersByTime(250)
    await flushAsync(16)
    expect(h.runGenerators).toHaveBeenCalledTimes(2)
    expect(h.runGenerators.mock.calls[1][1]?.changes).toEqual([
      expect.objectContaining({ kind: 'add', category: 'di', key: 'di.ts' }),
    ])
    await handle.close()
  })

  it('unions deletions and additions during a running suite against its successful candidate', async () => {
    const h = harness()
    const first = deferred<void>()
    h.runGenerators.mockImplementationOnce(() => first.promise)
    const handle = startInProcessGenerateWatcher(h.options)
    await flushAsync(12)
    h.update(snapshot([['api/item.ts', 'api-route', 'after']]))
    jest.advanceTimersByTime(250)
    await flushAsync(12)
    h.update(snapshot([]))
    h.update(snapshot([['search.ts', 'search', 'new']]))
    h.update(snapshot([
      ['search.ts', 'search', 'new'],
      ['di.ts', 'di', 'new'],
    ]))
    jest.advanceTimersByTime(1000)
    await flushAsync(12)
    expect(h.runGenerators).toHaveBeenCalledTimes(1)
    first.resolve()
    await flushAsync(16)
    jest.advanceTimersByTime(250)
    await flushAsync(16)
    const nextPlan = h.runGenerators.mock.calls[1][1]
    expect(nextPlan?.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'delete', category: 'api-route' }),
      expect.objectContaining({ kind: 'add', category: 'search' }),
      expect.objectContaining({ kind: 'add', category: 'di' }),
    ]))
    expect(nextPlan?.changes).toHaveLength(3)
    expect(nextPlan?.groups).toEqual(expect.arrayContaining(['registry', 'di', 'openapi']))
    await handle.close()
  })

  it('keeps events received during asynchronous capture dirty until the next capture', async () => {
    const h = harness()
    const capture = deferred<GenerateWatchSnapshot>()
    const handle = startInProcessGenerateWatcher(h.options)
    await flushAsync(12)
    h.capture.mockImplementationOnce(() => capture.promise)
    h.markChanged()
    jest.advanceTimersByTime(250)
    await flushAsync(12)
    h.update(snapshot([['di.ts', 'di', 'new']]))
    capture.resolve(snapshot([['api/item.ts', 'api-route', 'after']]))
    await flushAsync(16)
    jest.advanceTimersByTime(250)
    await flushAsync(16)
    expect(h.runGenerators).toHaveBeenCalledTimes(2)
    expect(h.runGenerators.mock.calls[1][1]?.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'delete', category: 'api-route' }),
      expect.objectContaining({ kind: 'add', category: 'di' }),
    ]))
    await handle.close()
  })

  it('keeps unchanged polling snapshots idle but uses a full plan when inputs change', async () => {
    const h = harness()
    h.usePollingFallback()
    const handle = startInProcessGenerateWatcher(h.options)
    await flushAsync(12)
    h.markChanged()
    jest.advanceTimersByTime(250)
    await flushAsync(16)
    expect(h.runGenerators).not.toHaveBeenCalled()
    h.update(snapshot([['api/item.ts', 'api-route', 'after']]))
    jest.advanceTimersByTime(250)
    await flushAsync(16)
    expect(h.runGenerators.mock.calls[0][1]?.mode).toBe('full')
    await handle.close()
  })

  it('runs one full suite for an unattributed event even when the tracked checksum is unchanged', async () => {
    const h = harness()
    let unknownVersion = -1
    h.options.changeSignal.fullGenerationReasonSince = (version) => unknownVersion > version ? 'unknown event' : undefined
    const handle = startInProcessGenerateWatcher(h.options)
    await flushAsync(12)
    h.markChanged()
    unknownVersion = h.signal.currentVersion()
    jest.advanceTimersByTime(250)
    await flushAsync(16)
    expect(h.runGenerators).toHaveBeenCalledTimes(1)
    expect(h.runGenerators.mock.calls[0][1]).toMatchObject({
      mode: 'full',
      reasons: expect.arrayContaining(['unknown event']),
    })
    jest.advanceTimersByTime(250)
    await flushAsync(16)
    expect(h.runGenerators).toHaveBeenCalledTimes(1)
    await handle.close()
  })

  it('acknowledges conservative plugin records after successful generation', async () => {
    const h = harness(false)
    h.usePollingFallback()
    h.capture.mockResolvedValue(snapshot([['generators.ts', 'generator-plugin', 'dynamic-conventions']]))
    const handle = startInProcessGenerateWatcher(h.options)
    await flushAsync(16)
    jest.advanceTimersByTime(250)
    await flushAsync(16)
    jest.advanceTimersByTime(250)
    await flushAsync(16)
    expect(h.runGenerators).toHaveBeenCalledTimes(1)
    await handle.close()
  })

  it('does not generate after close interrupts a pending capture', async () => {
    const h = harness()
    const capture = deferred<GenerateWatchSnapshot>()
    h.capture.mockImplementationOnce(() => capture.promise)
    const handle = startInProcessGenerateWatcher(h.options)
    await flushAsync(12)
    const closing = handle.close()
    capture.resolve(snapshot([['di.ts', 'di', 'new']]))
    await closing
    jest.advanceTimersByTime(1000)
    await flushAsync(12)
    expect(h.runGenerators).not.toHaveBeenCalled()
    expect(h.capture).toHaveBeenCalledTimes(1)
  })

  it('waits for the active suite when closing and never starts queued work', async () => {
    const h = harness(false)
    const generation = deferred<void>()
    h.runGenerators.mockImplementationOnce(() => generation.promise)
    const handle = startInProcessGenerateWatcher(h.options)
    await flushAsync(12)
    h.update(snapshot([['di.ts', 'di', 'new']]))
    let closed = false
    const closing = handle.close().then(() => { closed = true })
    await flushAsync(12)
    expect(closed).toBe(false)
    generation.resolve()
    await closing
    expect(closed).toBe(true)
    jest.advanceTimersByTime(1000)
    await flushAsync(12)
    expect(h.runGenerators).toHaveBeenCalledTimes(1)
  })

  it('retries checksum-only callbacks without changing their one-argument contract', async () => {
    const runGenerators = jest.fn<Promise<void>, [string]>()
      .mockRejectedValueOnce(new Error('failed full suite'))
      .mockResolvedValue(undefined)
    const { signal } = createFakeChangeSignal()
    const handle = startInProcessGenerateWatcher({
      pollMs: 250,
      logger: silentLogger,
      quiet: true,
      changeSignal: signal,
      computeStructureChecksum: () => 'same-input',
      runGenerators,
    })
    await flushAsync(16)
    jest.advanceTimersByTime(250)
    await flushAsync(16)
    expect(runGenerators.mock.calls).toEqual([
      ['initial'],
      ['retry after failed generation'],
    ])
    await handle.close()
  })

  it('keeps an uncertain snapshot dirty until it becomes authoritative', async () => {
    const h = harness(false)
    const uncertain = { ...snapshot([]), fullReasons: ['unreadable source'] }
    h.capture.mockResolvedValue(uncertain)
    const handle = startInProcessGenerateWatcher(h.options)
    await flushAsync(16)
    jest.advanceTimersByTime(250)
    await flushAsync(16)
    expect(h.runGenerators).toHaveBeenCalledTimes(2)
    expect(h.runGenerators.mock.calls[1][1]?.reasons).toContain('unreadable source')
    h.capture.mockResolvedValue(snapshot([]))
    jest.advanceTimersByTime(250)
    await flushAsync(16)
    expect(h.runGenerators).toHaveBeenCalledTimes(3)
    jest.advanceTimersByTime(250)
    await flushAsync(16)
    expect(h.runGenerators).toHaveBeenCalledTimes(3)
    await handle.close()
  })
})
