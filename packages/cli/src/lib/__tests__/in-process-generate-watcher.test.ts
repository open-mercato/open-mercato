import { startInProcessGenerateWatcher } from '../in-process-generate-watcher'

const silentLogger = { log: jest.fn(), error: jest.fn() }

async function flushAsync(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve()
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
