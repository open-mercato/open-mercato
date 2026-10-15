type InjectionLoader = typeof import('../injection-loader')

const registryGlobals = [
  '__openMercatoCoreInjectionWidgetEntries__',
  '__openMercatoCoreInjectionTables__',
  '__openMercatoEnabledModuleIds__',
  '__openMercatoCoreInjectionRegistryVersion__',
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

  it('preserves the unregistered state for an empty merge contribution', () => {
    const loader = freshLoader()
    loader.registerCoreInjectionTables([])
    loader.registerCoreInjectionWidgets([], { mode: 'merge' })

    expect(loader.isInjectionRegistryReady()).toBe(false)
  })
})
