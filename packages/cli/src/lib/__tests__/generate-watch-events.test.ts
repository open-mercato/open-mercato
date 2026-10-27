import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createGenerateWatchChangeSignal,
  resolveGenerateWatchTargets,
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
    directoryExists: () => true,
  })

  return {
    signal,
    registered,
    watchDirectory,
    setTargets: (nextTargets: GenerateWatchTarget[]) => { targets = nextTargets },
  }
}

describe('createGenerateWatchChangeSignal', () => {
  it('keeps app-module watches idle without inventing a node_modules/@app target', async () => {
    const projectRoot = path.resolve('/virtual/standalone-app')
    const modulesFile = path.join(projectRoot, 'src', 'modules.ts')
    const appBase = path.join(projectRoot, 'src', 'modules', 'custom_module')
    const impossiblePackageBase = path.join(
      projectRoot,
      'node_modules',
      '@app',
      'src',
      'modules',
      'custom_module',
    )
    const resolveSourceMirrorBase = jest.fn(() => null)
    const targets = resolveGenerateWatchTargets({
      modulesFile,
      moduleRoots: [{
        appBase,
        pkgBase: impossiblePackageBase,
        watchPackageBase: false,
      }],
      resolveSourceMirrorBase,
    })

    expect(targets).toEqual([
      {
        directory: path.dirname(modulesFile),
        recursive: false,
        fileName: path.basename(modulesFile),
      },
      {
        directory: path.dirname(appBase),
        recursive: true,
      },
    ])
    expect(resolveSourceMirrorBase).not.toHaveBeenCalled()

    const signal = createGenerateWatchChangeSignal({
      getWatchTargets: () => targets,
      directoryExists: () => true,
      watchDirectory: () => ({ close: jest.fn() }),
    })
    await signal.refresh()
    expect(signal.hasSkippedTargets?.()).toBe(false)
    await signal.close()
  })

  it('retains the real package fallback target for app modules in monorepo mode', () => {
    const projectRoot = path.resolve('/virtual/monorepo')
    const modulesFile = path.join(projectRoot, 'apps', 'mercato', 'src', 'modules.ts')
    const appBase = path.join(
      projectRoot,
      'apps',
      'mercato',
      'src',
      'modules',
      'custom_module',
    )
    const packageBase = path.join(
      projectRoot,
      'packages',
      'core',
      'src',
      'modules',
      'custom_module',
    )
    const resolveSourceMirrorBase = jest.fn(() => null)

    const targets = resolveGenerateWatchTargets({
      modulesFile,
      moduleRoots: [{
        appBase,
        pkgBase: packageBase,
        watchPackageBase: true,
      }],
      resolveSourceMirrorBase,
    })

    expect(targets).toContainEqual({
      directory: path.dirname(appBase),
      recursive: true,
    })
    expect(targets).toContainEqual({
      directory: path.dirname(packageBase),
      recursive: true,
    })
    expect(resolveSourceMirrorBase).toHaveBeenCalledWith(packageBase)
  })

  it('retains missing package-module targets so idle refresh discovers them later', async () => {
    const projectRoot = path.resolve('/virtual/standalone-app')
    const modulesFile = path.join(projectRoot, 'src', 'modules.ts')
    const appBase = path.join(projectRoot, 'src', 'modules', 'official_module')
    const packageBase = path.join(
      projectRoot,
      'node_modules',
      '@open-mercato',
      'official-package',
      'dist',
      'modules',
      'official_module',
    )
    const packageModulesDir = path.dirname(packageBase)
    const targets = resolveGenerateWatchTargets({
      modulesFile,
      moduleRoots: [{
        appBase,
        pkgBase: packageBase,
        watchPackageBase: true,
      }],
      resolveSourceMirrorBase: () => null,
    })
    const existing = new Set([
      path.dirname(modulesFile),
      path.dirname(appBase),
    ])
    const registered: string[] = []
    const signal = createGenerateWatchChangeSignal({
      getWatchTargets: () => targets,
      directoryExists: (directory) => existing.has(directory),
      watchDirectory: (target) => {
        registered.push(target.directory)
        return { close: jest.fn() }
      },
    })

    await signal.refresh()
    expect(signal.hasSkippedTargets?.()).toBe(true)
    expect(registered).not.toContain(packageModulesDir)

    existing.add(packageModulesDir)
    await signal.refresh()
    expect(signal.hasSkippedTargets?.()).toBe(false)
    expect(registered).toContain(packageModulesDir)
    await signal.close()
  })

  it('skips missing directories without falling back and retries them on refresh', async () => {
    const present = path.resolve('./modules-present')
    const delayed = path.resolve('./modules-delayed')
    const existing = new Set([present])
    const registered: GenerateWatchTarget[] = []
    const signal = createGenerateWatchChangeSignal({
      getWatchTargets: () => [
        { directory: present, recursive: true },
        { directory: delayed, recursive: true },
      ],
      directoryExists: (directory) => existing.has(directory),
      watchDirectory: (target) => {
        registered.push(target)
        return { close: jest.fn() }
      },
    })

    await signal.refresh()
    expect(registered.map((target) => target.directory)).toEqual([present])
    expect(signal.hasSkippedTargets?.()).toBe(true)
    expect(signal.usesPollingFallback()).toBe(false)

    existing.add(delayed)
    await signal.refresh()
    expect(registered.map((target) => target.directory)).toEqual([present, delayed])
    expect(signal.hasSkippedTargets?.()).toBe(false)
    expect(signal.usesPollingFallback()).toBe(false)
  })

  it('reports a missing directory once while it remains skipped', async () => {
    const missing = path.resolve('./modules-missing')
    const onSkippedDirectory = jest.fn()
    const options = {
      getWatchTargets: () => [{ directory: missing, recursive: true }],
      directoryExists: () => false,
      watchDirectory: jest.fn(() => ({ close: jest.fn() })),
      onSkippedDirectory,
    }
    const signal = createGenerateWatchChangeSignal(options)

    await signal.refresh()
    await signal.refresh()

    expect(onSkippedDirectory).toHaveBeenCalledTimes(1)
    expect(onSkippedDirectory).toHaveBeenCalledWith(missing)
  })

  it('uses filesystem existence checks by default', async () => {
    const present = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-generate-watch-'))
    const missing = path.join(present, 'missing')
    const registered: string[] = []
    const signal = createGenerateWatchChangeSignal({
      getWatchTargets: () => [
        { directory: present, recursive: true },
        { directory: missing, recursive: true },
      ],
      watchDirectory: (target) => {
        registered.push(target.directory)
        return { close: jest.fn() }
      },
    })

    try {
      await signal.refresh()
      expect(registered).toEqual([present])
      expect(signal.usesPollingFallback()).toBe(false)
    } finally {
      await signal.close()
      fs.rmSync(present, { recursive: true, force: true })
    }
  })

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
      directoryExists: () => true,
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
