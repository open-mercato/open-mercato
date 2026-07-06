import type { Module } from '@open-mercato/shared/modules/registry'

const GLOBAL_KEY = '__openMercatoModulesRegistry__'

function clearGlobalRegistry(): void {
  delete (globalThis as any)[GLOBAL_KEY]
}

function clearRegistryModuleCache(): void {
  const matchers = [/packages\/shared\/src\/lib\/modules\/registry\.ts$/]
  for (const key of Object.keys(require.cache)) {
    if (matchers.some((re) => re.test(key))) {
      delete require.cache[key]
    }
  }
}

function loadRegistry(): typeof import('../registry') {
  clearRegistryModuleCache()
  return require('../registry') as typeof import('../registry')
}

describe('shared modules registry', () => {
  const sampleModules: Module[] = [
    { id: 'auth' } as Module,
    { id: 'customers' } as Module,
  ]

  let nodeEnvSnapshot: string | undefined

  beforeEach(() => {
    nodeEnvSnapshot = process.env.NODE_ENV
    clearGlobalRegistry()
  })

  afterEach(() => {
    clearGlobalRegistry()
    if (nodeEnvSnapshot === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = nodeEnvSnapshot
    }
    clearRegistryModuleCache()
  })

  it('returns registered modules from the same module instance', () => {
    const registry = loadRegistry()
    registry.registerModules(sampleModules)
    expect(registry.getModules().map((m) => m.id)).toEqual(['auth', 'customers'])
  })

  it('throws a helpful error when getModules is called before bootstrap', () => {
    const registry = loadRegistry()
    expect(() => registry.getModules()).toThrow(
      '[Bootstrap] Modules not registered. Call registerModules() at bootstrap.',
    )
  })

  it('survives module duplication: a re-required registry instance still sees modules registered by the first', () => {
    // First load: bootstrap registers modules via the "source" path.
    const first = loadRegistry()
    first.registerModules(sampleModules)
    expect(first.getModules().map((m) => m.id)).toEqual(['auth', 'customers'])

    // Second load: simulate tsx/esbuild re-loading the same file under a
    // different module identity (e.g. dist/ vs src/). This is the exact
    // failure mode hit by the standalone TC-CRM-068/069 worker handlers —
    // they create a fresh container, which calls getModules() through a
    // different registry instance than the test's bootstrap registered into.
    // With the module-local `let _modules` variant, this re-require would
    // throw `[Bootstrap] Modules not registered`. With the globalThis
    // variant it returns the same list.
    const second = loadRegistry()
    expect(second.getModules().map((m) => m.id)).toEqual(['auth', 'customers'])
  })

  it('reads from globalThis so external setters can prime the registry', () => {
    // Simulates the case where a bootstrap script in a sibling process or
    // sibling module instance already wrote to `globalThis` before this
    // package's registry module was even loaded.
    ;(globalThis as any).__openMercatoModulesRegistry__ = sampleModules
    const registry = loadRegistry()
    expect(registry.getModules().map((m) => m.id)).toEqual(['auth', 'customers'])
  })

  it('emits the HMR debug log on re-registration in development', () => {
    process.env.NODE_ENV = 'development'
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {})
    try {
      const registry = loadRegistry()
      registry.registerModules(sampleModules)
      expect(debugSpy).not.toHaveBeenCalled()
      registry.registerModules(sampleModules)
      expect(debugSpy).toHaveBeenCalledWith(
        '[Bootstrap] Modules re-registered (this may occur during HMR)',
      )
    } finally {
      debugSpy.mockRestore()
    }
  })

  it('does not emit the HMR debug log when NODE_ENV is not development', () => {
    process.env.NODE_ENV = 'production'
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {})
    try {
      const registry = loadRegistry()
      registry.registerModules(sampleModules)
      registry.registerModules(sampleModules)
      expect(debugSpy).not.toHaveBeenCalled()
    } finally {
      debugSpy.mockRestore()
    }
  })

  it('does not let i18n-only registrations clobber runtime module contracts', () => {
    const registry = loadRegistry()
    const handler = jest.fn()
    registry.registerModules([
      {
        id: 'checkout',
        subscribers: [{ id: 'checkout-gateway-payment-failed', event: 'payment_gateways.payment.failed', handler }],
        translations: { en: { old: 'Old' } },
      } as Module,
    ])

    registry.registerModules([
      {
        id: 'checkout',
        translations: { en: { fresh: 'Fresh' } },
      } as Module,
    ])

    expect(registry.getModules()).toEqual([
      expect.objectContaining({
        id: 'checkout',
        subscribers: [expect.objectContaining({ id: 'checkout-gateway-payment-failed' })],
        translations: { en: { fresh: 'Fresh' } },
      }),
    ])
  })
})
