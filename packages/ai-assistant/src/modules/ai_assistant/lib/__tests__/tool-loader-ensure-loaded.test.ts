/**
 * `ensureModuleToolsLoaded` is now on the hot path — every agent tool
 * resolution calls it. `loadAllModuleTools` is idempotent in effect (it
 * re-registers into a keyed map) but not cheap: four dynamic imports and an
 * OpenAPI spec load. The memo is what makes calling it per-resolution
 * affordable, so it is worth pinning.
 */
import { ensureModuleToolsLoaded, resetModuleToolsLoadedForTests } from '../tool-loader'
import { toolRegistry } from '../tool-registry'

const loadCodeModeTools = jest.fn(async () => 2)
jest.mock('../codemode-tools', () => ({ loadCodeModeTools: () => loadCodeModeTools() }))

describe('ensureModuleToolsLoaded', () => {
  beforeEach(() => {
    loadCodeModeTools.mockClear()
    resetModuleToolsLoadedForTests()
    toolRegistry.clear()
  })

  afterEach(() => {
    resetModuleToolsLoadedForTests()
    toolRegistry.clear()
  })

  it('populates the registry', async () => {
    await ensureModuleToolsLoaded()

    expect(loadCodeModeTools).toHaveBeenCalledTimes(1)
    // The built-in registered synchronously, independent of the dynamic imports.
    expect(toolRegistry.getTool('context_whoami')).toBeDefined()
  })

  it('loads once however many times it is called', async () => {
    await ensureModuleToolsLoaded()
    await ensureModuleToolsLoaded()
    await ensureModuleToolsLoaded()

    expect(loadCodeModeTools).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight load between concurrent callers', async () => {
    await Promise.all([
      ensureModuleToolsLoaded(),
      ensureModuleToolsLoaded(),
      ensureModuleToolsLoaded(),
    ])

    expect(loadCodeModeTools).toHaveBeenCalledTimes(1)
  })
})
