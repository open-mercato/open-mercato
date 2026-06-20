/**
 * Regression test for the trigger-cache globalThis storage introduced in this PR.
 *
 * Why this test exists
 * --------------------
 * The wildcard `*` event-trigger subscriber reads triggers via
 * `loadTriggersForTenant`. That function is fronted by an in-memory cache keyed
 * by `tenant:org`. Cache invalidation happens from the PUT /api/workflows/
 * definitions route via `invalidateTriggerCache(...)`.
 *
 * In production builds, the same compiled `event-trigger-service.ts` file can
 * be loaded under two import roots (for example a Next.js server chunk vs. a
 * queue worker that resolves the file through a different path). When the
 * trigger cache lives in a module-local `const map = new Map(...)`, each loaded
 * copy of the module has its own cache. Then `invalidateTriggerCache` called
 * from the API route's module-instance does NOT clear the cache that the
 * subscriber reads through, so a newly added trigger is invisible to the
 * subscriber for up to `TRIGGER_CACHE_TTL` (5 minutes).
 *
 * The fix is to park the cache `Map` on `globalThis` under
 * `__openMercatoWorkflowTriggerCache__`, mirroring the workaround already used
 * by the modules registry (PR #2046 Phase 1) and `getDiRegistrars()`. With the
 * fix, both module-instances reach the same `Map` via `globalThis`, so an
 * invalidation from any instance is observed by every reader.
 *
 * This test locks the regression by:
 *   1. Asserting `globalThis.__openMercatoWorkflowTriggerCache__` exists as a
 *      Map after the module is imported and used.
 *   2. Asserting `invalidateTriggerCache` clears entries from the global Map.
 *   3. Asserting a freshly re-imported copy of the module observes the same
 *      Map (proving module-duplication survival) — the second copy reads the
 *      cache populated by the first.
 */

jest.mock('../workflow-executor', () => ({
  executeWorkflow: jest.fn(),
  startWorkflow: jest.fn(),
}))

const GLOBAL_KEY = '__openMercatoWorkflowTriggerCache__'

type CachedTriggers = {
  triggers: unknown[]
  cachedAt: number
}

describe('event-trigger-service — trigger cache survives module duplication via globalThis', () => {
  beforeEach(() => {
    delete (globalThis as any)[GLOBAL_KEY]
    jest.resetModules()
  })

  afterEach(() => {
    delete (globalThis as any)[GLOBAL_KEY]
  })

  it('exposes the trigger cache on globalThis after invalidateTriggerCache runs', async () => {
    const { invalidateTriggerCache } = await import('../event-trigger-service')

    // First touch — the lazy getter should install a Map on globalThis.
    invalidateTriggerCache('tenant-a', 'org-a')

    const installed = (globalThis as any)[GLOBAL_KEY] as Map<string, CachedTriggers> | undefined
    expect(installed).toBeInstanceOf(Map)
  })

  it('lets a second module instance observe entries set by the first', async () => {
    // Simulate "module duplication": import the service twice with the
    // require.cache wiped between imports. Both copies must reach the same
    // global Map, so a cache entry written via copy A is readable from copy B
    // and a delete via copy B is visible to copy A.
    const firstImport = await import('../event-trigger-service')

    // Reach into the shared global Map and prime it as if copy A had cached
    // a tenant's triggers (the load helper itself is async + DB-bound, so we
    // assert the structural invariant rather than reproducing the full load).
    const cache = (globalThis as any)[GLOBAL_KEY] = (globalThis as any)[GLOBAL_KEY]
      ?? new Map<string, CachedTriggers>()
    cache.set('tenant-a:org-a', { triggers: [{ id: 'sentinel' }], cachedAt: Date.now() })

    jest.resetModules()
    const secondImport = await import('../event-trigger-service')
    expect(secondImport).not.toBe(firstImport)

    // Copy B invalidates the same key — the global Map (the only one) must
    // lose the entry, proving both copies share state.
    secondImport.invalidateTriggerCache('tenant-a', 'org-a')
    expect(cache.has('tenant-a:org-a')).toBe(false)
  })

  it('invalidateTriggerCache(tenantId) without org wipes every org under that tenant', async () => {
    const { invalidateTriggerCache } = await import('../event-trigger-service')
    invalidateTriggerCache('tenant-a', 'org-a')
    const cache = (globalThis as any)[GLOBAL_KEY] as Map<string, CachedTriggers>
    cache.set('tenant-a:org-a', { triggers: [], cachedAt: Date.now() })
    cache.set('tenant-a:org-b', { triggers: [], cachedAt: Date.now() })
    cache.set('tenant-b:org-a', { triggers: [], cachedAt: Date.now() })

    invalidateTriggerCache('tenant-a')

    expect(cache.has('tenant-a:org-a')).toBe(false)
    expect(cache.has('tenant-a:org-b')).toBe(false)
    expect(cache.has('tenant-b:org-a')).toBe(true)
  })

  it('reuses an existing globalThis cache instead of replacing it', async () => {
    const seeded = new Map<string, CachedTriggers>()
    seeded.set('tenant-x:org-x', { triggers: [], cachedAt: Date.now() })
    ;(globalThis as any)[GLOBAL_KEY] = seeded

    const { invalidateTriggerCache } = await import('../event-trigger-service')
    invalidateTriggerCache('tenant-x', 'org-x')

    // The pre-existing Map must remain the canonical instance (no replacement).
    expect((globalThis as any)[GLOBAL_KEY]).toBe(seeded)
    expect(seeded.has('tenant-x:org-x')).toBe(false)
  })
})
