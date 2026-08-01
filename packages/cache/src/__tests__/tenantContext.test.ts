const TENANT_STORAGE_KEY = Symbol.for('@open-mercato/cache/tenant-context')

function clearGlobalStorage(): void {
  delete (globalThis as Record<symbol, unknown>)[TENANT_STORAGE_KEY]
}

describe('cache tenant context', () => {
  beforeEach(() => {
    clearGlobalStorage()
    jest.resetModules()
  })

  afterEach(() => {
    clearGlobalStorage()
  })

  it('exposes the tenant inside runWithCacheTenant and null outside', () => {
    const { runWithCacheTenant, getCurrentCacheTenant } = require('../tenantContext')
    expect(getCurrentCacheTenant()).toBeNull()
    runWithCacheTenant('tenant-a', () => {
      expect(getCurrentCacheTenant()).toBe('tenant-a')
    })
    expect(getCurrentCacheTenant()).toBeNull()
  })

  it('shares the storage across duplicated module copies via globalThis', () => {
    // Simulate a bundler emitting the module into two chunks: two separate
    // module instances must still observe one shared AsyncLocalStorage,
    // otherwise a tenant entered through one copy (an API route) is invisible
    // to the other (the cache service wrapper) and entries get stored under
    // the tenant:global prefix that tenant-scoped invalidations never target.
    const copyA = require('../tenantContext')
    jest.resetModules()
    const copyB = require('../tenantContext')
    expect(copyB).not.toBe(copyA)

    copyA.runWithCacheTenant('tenant-shared', () => {
      expect(copyB.getCurrentCacheTenant()).toBe('tenant-shared')
    })
    expect(copyB.getCurrentCacheTenant()).toBeNull()
  })

  it('nested contexts restore the outer tenant', () => {
    const { runWithCacheTenant, getCurrentCacheTenant } = require('../tenantContext')
    runWithCacheTenant('outer', () => {
      runWithCacheTenant('inner', () => {
        expect(getCurrentCacheTenant()).toBe('inner')
      })
      expect(getCurrentCacheTenant()).toBe('outer')
    })
  })
})
