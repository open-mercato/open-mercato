/**
 * Phase 2 — unified `entry.overrides.routes.api` wiring.
 *
 * Covers:
 *   - The dispatcher routes `overrides.routes.api` to the wired applier
 *     (no "Domain routes not yet wired" warning).
 *   - The applier still emits a sub-domain warning for unwired
 *     `overrides.routes.pages` (Phase 3).
 *   - `applyApiOverridesToManifests` drops disabled methods, drops fully
 *     disabled entries, and wraps `load()` for replacement handlers.
 *   - Programmatic overrides supersede `modules.ts` overrides.
 *   - `registerApiRouteManifests` consults the override composer.
 *   - Stale override keys emit a warning so operators notice.
 *
 * Spec: `.ai/specs/2026-05-04-modules-ts-unified-overrides.md`.
 */
import {
  applyApiOverridesToManifests,
  applyApiRouteOverrides,
  applyModuleOverridesFromEnabledModules,
  composeApiRouteOverrides,
  resetApiRouteOverridesForTests,
  type ApiRouteOverridesMap,
} from '../overrides'
import {
  getApiRouteManifests,
  registerApiRouteManifests,
  type ApiHandler,
  type ApiRouteManifestEntry,
  type HttpMethod,
} from '../registry'

function makeEntry(
  moduleId: string,
  path: string,
  methods: HttpMethod[],
  loadResult: Record<string, unknown> = {},
): ApiRouteManifestEntry {
  return {
    moduleId,
    kind: 'route-file',
    path,
    methods,
    load: jest.fn(async () => ({ ...loadResult })),
  }
}

function makeHandler(label: string): ApiHandler {
  return () => new Response(label)
}

beforeEach(() => {
  resetApiRouteOverridesForTests()
  registerApiRouteManifests([])
})

afterEach(() => {
  registerApiRouteManifests([])
})

describe('applyApiOverridesToManifests', () => {
  it('returns input unchanged when overrides map is empty', () => {
    const entries = [makeEntry('a', '/api/foo', ['GET'])]
    const result = applyApiOverridesToManifests(entries, {})
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(entries[0])
  })

  it('drops a single method when override is null', () => {
    const entries = [makeEntry('a', '/api/foo', ['GET', 'POST'])]
    const result = applyApiOverridesToManifests(entries, {
      'GET /api/foo': null,
    })
    expect(result).toHaveLength(1)
    expect(result[0].methods).toEqual(['POST'])
  })

  it('drops the entry entirely when every method is disabled', () => {
    const entries = [makeEntry('a', '/api/foo', ['GET', 'POST'])]
    const result = applyApiOverridesToManifests(entries, {
      'GET /api/foo': null,
      'POST /api/foo': null,
    })
    expect(result).toHaveLength(0)
  })

  it('wraps load() to swap the handler for replaced methods', async () => {
    const originalHandler = makeHandler('original')
    const overrideHandler = makeHandler('override')
    const entries = [
      makeEntry('a', '/api/foo', ['GET', 'POST'], {
        GET: originalHandler,
        POST: originalHandler,
        metadata: { GET: { requireAuth: true } },
      }),
    ]
    const result = applyApiOverridesToManifests(entries, {
      'GET /api/foo': { handler: overrideHandler, metadata: { requireAuth: false } },
    })
    expect(result).toHaveLength(1)
    expect(result[0].methods).toEqual(['GET', 'POST'])

    const loaded = (await result[0].load()) as Record<string, unknown>
    expect(loaded.GET).toBe(overrideHandler)
    expect(loaded.POST).toBe(originalHandler)
    expect(loaded.metadata).toEqual({
      GET: { requireAuth: false },
      // POST untouched.
    })
  })

  it('does not mutate the input array or entries', () => {
    const entry = makeEntry('a', '/api/foo', ['GET'])
    const original = entry.methods
    const result = applyApiOverridesToManifests([entry], {
      'GET /api/foo': null,
    })
    expect(entry.methods).toBe(original)
    expect(entry.methods).toEqual(['GET'])
    expect(result).toHaveLength(0)
  })

  it('warns when an override key does not match any manifest entry', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    applyApiOverridesToManifests([makeEntry('a', '/api/foo', ['GET'])], {
      'GET /api/missing': null,
    })
    const staleCalls = warnSpy.mock.calls.filter((args) =>
      typeof args[0] === 'string' && args[0].includes('did not match any registered API route'),
    )
    expect(staleCalls).toHaveLength(1)
    expect(staleCalls[0][0]).toContain('GET /api/missing')
    warnSpy.mockRestore()
  })

  it('skips malformed override values (not null and not a definition)', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const entries = [makeEntry('a', '/api/foo', ['GET'])]
    const result = applyApiOverridesToManifests(entries, {
      // @ts-expect-error intentionally malformed
      'GET /api/foo': { metadata: { requireAuth: false } },
    })
    expect(result).toHaveLength(1)
    expect(result[0].methods).toEqual(['GET'])
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('applyApiRouteOverrides (programmatic)', () => {
  it('normalizes the key format (case-insensitive method, leading-slash optional)', () => {
    applyApiRouteOverrides({
      'get  api/foo': null,
      'Post /api/bar/': null,
    })
    const composed = composeApiRouteOverrides()
    expect(composed['GET /api/foo']).toBeNull()
    expect(composed['POST /api/bar']).toBeNull()
  })

  it('warns on malformed keys and skips them', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    applyApiRouteOverrides({
      'NOT_A_METHOD /api/foo': null,
      'GET': null,
      '': null,
    })
    expect(Object.keys(composeApiRouteOverrides())).toHaveLength(0)
    expect(warnSpy.mock.calls.filter((c) =>
      typeof c[0] === 'string' && c[0].includes('malformed routes.api key'),
    )).toHaveLength(3)
    warnSpy.mockRestore()
  })

  it('supersedes modules.ts inline overrides for the same key', () => {
    applyModuleOverridesFromEnabledModules([
      {
        id: 'app',
        overrides: { routes: { api: { 'GET /api/foo': null } } },
      },
    ])
    const override = { handler: makeHandler('replacement') }
    applyApiRouteOverrides({ 'GET /api/foo': override })
    expect(composeApiRouteOverrides()['GET /api/foo']).toBe(override)
  })
})

describe('dispatcher → routes applier', () => {
  it('routes `overrides.routes.api` to the wired applier without the "not yet wired" warning', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    applyModuleOverridesFromEnabledModules([
      {
        id: 'app',
        overrides: { routes: { api: { 'GET /api/foo': null } } },
      },
    ])
    const unwiredCalls = warnSpy.mock.calls.filter((args) =>
      typeof args[0] === 'string' && args[0].includes('Domain "routes" not yet wired'),
    )
    expect(unwiredCalls).toHaveLength(0)
    expect(composeApiRouteOverrides()['GET /api/foo']).toBeNull()
    warnSpy.mockRestore()
  })

  it('emits a one-shot warning when `overrides.routes.pages` is present (Phase 3 stubbed)', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    applyModuleOverridesFromEnabledModules([
      {
        id: 'app',
        overrides: { routes: { pages: { '/backend/foo': null } } },
      },
      {
        id: 'app2',
        overrides: { routes: { pages: { '/backend/bar': null } } },
      },
    ])
    const subDomainCalls = warnSpy.mock.calls.filter((args) =>
      typeof args[0] === 'string' && args[0].includes('Sub-domain "routes.pages" not yet wired'),
    )
    expect(subDomainCalls).toHaveLength(1)
    expect(subDomainCalls[0][0]).toContain('module(s) [app, app2]')
    expect(subDomainCalls[0][0]).toContain('issues/1787')
    warnSpy.mockRestore()
  })

  it('preserves module load order when multiple entries override the same key (last wins)', () => {
    const firstHandler = makeHandler('first')
    const secondHandler = makeHandler('second')
    applyModuleOverridesFromEnabledModules([
      {
        id: 'first',
        overrides: { routes: { api: { 'GET /api/foo': { handler: firstHandler } } } },
      },
      {
        id: 'second',
        overrides: { routes: { api: { 'GET /api/foo': { handler: secondHandler } } } },
      },
    ])
    const composed = composeApiRouteOverrides()
    expect(composed['GET /api/foo']).toEqual({ handler: secondHandler })
  })

  it('ignores malformed sub-keys but still processes well-formed ones', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const handler = makeHandler('ok')
    applyModuleOverridesFromEnabledModules([
      {
        id: 'app',
        overrides: {
          routes: {
            api: {
              'GET /api/ok': { handler },
              'BADMETHOD /api/x': null,
            },
          },
        },
      },
    ])
    expect(composeApiRouteOverrides()['GET /api/ok']).toEqual({ handler })
    expect(warnSpy.mock.calls.filter((c) =>
      typeof c[0] === 'string' && c[0].includes('malformed routes.api key'),
    )).toHaveLength(1)
    warnSpy.mockRestore()
  })
})

describe('registerApiRouteManifests consults overrides', () => {
  it('drops disabled methods at registration time', () => {
    applyModuleOverridesFromEnabledModules([
      {
        id: 'app',
        overrides: { routes: { api: { 'GET /api/foo': null } } },
      },
    ])
    registerApiRouteManifests([makeEntry('a', '/api/foo', ['GET', 'POST'])])
    const registered = getApiRouteManifests()
    expect(registered).toHaveLength(1)
    expect(registered[0].methods).toEqual(['POST'])
  })

  it('returns an unmodified manifest when no overrides are registered', () => {
    const entries = [makeEntry('a', '/api/foo', ['GET'])]
    registerApiRouteManifests(entries)
    const registered = getApiRouteManifests()
    expect(registered).toHaveLength(1)
    expect(registered[0]).toBe(entries[0])
  })

  it('replaces the handler via the wrapped load() when override is a definition', async () => {
    const originalHandler = makeHandler('original')
    const overrideHandler = makeHandler('override')
    applyApiRouteOverrides({
      'GET /api/foo': { handler: overrideHandler, metadata: { requireAuth: false } },
    })
    registerApiRouteManifests([
      makeEntry('a', '/api/foo', ['GET'], { GET: originalHandler }),
    ])
    const registered = getApiRouteManifests()
    expect(registered).toHaveLength(1)
    const loaded = (await registered[0].load()) as Record<string, unknown>
    expect(loaded.GET).toBe(overrideHandler)
    expect(loaded.metadata).toEqual({ GET: { requireAuth: false } })
  })
})
