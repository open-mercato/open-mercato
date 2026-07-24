import {
  startInProcessGenerateWatcher,
  type GenerateWatcherChangeSignal,
} from '../in-process-generate-watcher'

const silentLogger = { log: jest.fn(), error: jest.fn() }

async function flushAsync(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}

function createFakeChangeSignal() {
  let version = 0
  let fallback = false
  const signal: GenerateWatcherChangeSignal = {
    currentVersion: () => version,
    refresh: jest.fn(async () => undefined),
    usesPollingFallback: () => fallback,
    close: jest.fn(async () => undefined),
  }
  return {
    signal,
    markChanged: () => { version += 1 },
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

    // Tick #2 and #3 must NOT spawn parallel runs while #1 is in flight —
    // the helper serializes via the running/pending pair plus the
    // single-shot finally-scheduled poll cycle.
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
    expect(message).toMatch(/Generation failed/)
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
    expect(true).toBe(true)
  })
})
