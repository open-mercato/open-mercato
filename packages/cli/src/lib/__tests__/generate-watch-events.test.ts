import path from 'node:path'
import {
  createGenerateWatchChangeSignal,
  type GenerateWatchTarget,
} from '../generate-watch-events'

type RegisteredWatcher = {
  target: GenerateWatchTarget
  onChange: () => void
  onError: () => void
  close: jest.Mock
}

function createWatchHarness(initialTargets: GenerateWatchTarget[]) {
  let targets = initialTargets
  const registered: RegisteredWatcher[] = []
  const watchDirectory = jest.fn((
    target: GenerateWatchTarget,
    onChange: () => void,
    onError: () => void,
  ) => {
    const watcher = { target, onChange, onError, close: jest.fn() }
    registered.push(watcher)
    return watcher
  })
  const signal = createGenerateWatchChangeSignal({
    getWatchTargets: () => targets,
    watchDirectory,
  })

  return {
    signal,
    registered,
    watchDirectory,
    setTargets: (nextTargets: GenerateWatchTarget[]) => { targets = nextTargets },
  }
}

describe('createGenerateWatchChangeSignal', () => {
  it('deduplicates targets and increments its version on filesystem events', async () => {
    const target = { directory: './modules', recursive: true }
    const { signal, registered, watchDirectory } = createWatchHarness([target, target])

    await signal.refresh()
    expect(watchDirectory).toHaveBeenCalledTimes(1)
    expect(registered[0].target.directory).toBe(path.resolve('./modules'))
    expect(signal.currentVersion()).toBe(0)

    registered[0].onChange()
    registered[0].onChange()
    expect(signal.currentVersion()).toBe(2)
    expect(signal.usesPollingFallback()).toBe(false)
  })

  it('refreshes changed watch roots without recreating stable watchers', async () => {
    const first = { directory: './modules-a', recursive: true }
    const second = { directory: './modules-b', recursive: true }
    const harness = createWatchHarness([first])

    await harness.signal.refresh()
    harness.setTargets([first, second])
    await harness.signal.refresh()
    expect(harness.watchDirectory).toHaveBeenCalledTimes(2)
    expect(harness.registered[0].close).not.toHaveBeenCalled()

    harness.setTargets([second])
    await harness.signal.refresh()
    expect(harness.registered[0].close).toHaveBeenCalledTimes(1)
    expect(harness.registered[1].close).not.toHaveBeenCalled()
  })

  it('falls back to checksum polling when watcher setup fails', async () => {
    const firstClose = jest.fn()
    const watchDirectory = jest.fn()
      .mockReturnValueOnce({ close: firstClose })
      .mockImplementationOnce(() => { throw new Error('watch unavailable') })
    const signal = createGenerateWatchChangeSignal({
      getWatchTargets: () => [
        { directory: './modules-a', recursive: true },
        { directory: './modules-b', recursive: true },
      ],
      watchDirectory,
    })

    await signal.refresh()
    expect(signal.usesPollingFallback()).toBe(true)
    expect(signal.currentVersion()).toBe(1)
    expect(firstClose).toHaveBeenCalledTimes(1)
  })

  it('falls back to checksum polling when an active watcher errors', async () => {
    const { signal, registered } = createWatchHarness([
      { directory: './modules', recursive: true },
    ])

    await signal.refresh()
    registered[0].onError()
    expect(signal.usesPollingFallback()).toBe(true)
    expect(registered[0].close).toHaveBeenCalledTimes(1)
  })

  it('closes filesystem watchers exactly once', async () => {
    const { signal, registered } = createWatchHarness([
      { directory: './modules', recursive: true },
    ])

    await signal.refresh()
    await signal.close()
    await signal.close()
    expect(registered[0].close).toHaveBeenCalledTimes(1)
  })
})
