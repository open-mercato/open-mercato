type InjectionLoader = typeof import('../injection-loader')

const registryGlobals = [
  '__openMercatoCoreInjectionWidgetEntries__',
  '__openMercatoCoreInjectionTables__',
  '__openMercatoEnabledModuleIds__',
  '__openMercatoCoreInjectionRegistryVersion__',
  '__openMercatoCoreInjectionRegistryError__',
]

function freshLoader(): InjectionLoader {
  let loader: InjectionLoader | undefined
  jest.isolateModules(() => {
    loader = require('../injection-loader') as InjectionLoader
  })
  if (!loader) throw new Error('[internal] Injection loader was not initialized')
  return loader
}

describe('injection registry readiness', () => {
  beforeEach(() => {
    for (const key of registryGlobals) delete (globalThis as Record<string, unknown>)[key]
  })

  afterEach(() => {
    for (const key of registryGlobals) delete (globalThis as Record<string, unknown>)[key]
  })

  it('does not treat an unrelated registry version change as readiness', () => {
    const loader = freshLoader()

    expect(loader.isInjectionRegistryReady()).toBe(false)
    loader.registerEnabledModuleIds(['example'])

    expect(loader.getInjectionRegistryVersion()).toBeGreaterThan(0)
    expect(loader.isInjectionRegistryReady()).toBe(false)
  })

  it('waits for tables after widgets are registered, including an empty registry', () => {
    const loader = freshLoader()
    loader.registerCoreInjectionWidgets([])

    expect(loader.isInjectionRegistryReady()).toBe(false)

    loader.registerCoreInjectionTables([])

    expect(loader.isInjectionRegistryReady()).toBe(true)
  })

  it('waits for widgets when tables register first', () => {
    const loader = freshLoader()
    loader.registerCoreInjectionTables([])

    expect(loader.isInjectionRegistryReady()).toBe(false)

    loader.registerCoreInjectionWidgets([])

    expect(loader.isInjectionRegistryReady()).toBe(true)
  })

  it('reads readiness from registration in another module instance', () => {
    const writer = freshLoader()
    writer.registerCoreInjectionWidgets([])
    writer.registerCoreInjectionTables([])
    const reader = freshLoader()

    expect(reader.isInjectionRegistryReady()).toBe(true)
  })

  it('shares terminal failures and successful recovery across module instances', () => {
    const writer = freshLoader()
    const reader = freshLoader()
    const initialVersion = reader.getInjectionRegistryVersion()

    writer.setInjectionRegistryError('ChunkLoadError')

    expect(reader.getInjectionRegistryError()).toBe('ChunkLoadError')
    expect(reader.getInjectionRegistryVersion()).toBeGreaterThan(initialVersion)
    expect(reader.isInjectionRegistryReady()).toBe(false)
    const failureVersion = writer.getInjectionRegistryVersion()

    reader.registerCoreInjectionWidgets([])
    expect(reader.getInjectionRegistryVersion()).toBeGreaterThan(failureVersion)
    reader.registerCoreInjectionTables([])
    reader.setInjectionRegistryError(null)

    expect(writer.getInjectionRegistryError()).toBeNull()
    expect(writer.isInjectionRegistryReady()).toBe(true)
    expect(writer.getInjectionRegistryVersion()).toBeGreaterThan(failureVersion)
  })

  it('keeps an empty rejection message distinguishable from successful registration', () => {
    const loader = freshLoader()
    loader.setInjectionRegistryError('')

    expect(loader.getInjectionRegistryError()).toBeTruthy()
    expect(loader.isInjectionRegistryReady()).toBe(false)
  })

  it('preserves the unregistered state for an empty merge contribution', () => {
    const loader = freshLoader()
    loader.registerCoreInjectionTables([])
    loader.registerCoreInjectionWidgets([], { mode: 'merge' })

    expect(loader.isInjectionRegistryReady()).toBe(false)
  })
})
