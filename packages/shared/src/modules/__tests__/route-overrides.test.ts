/**
 * Phase 2/3 — unified `entry.overrides.routes.*` wiring.
 *
 * Covers:
 *   - The dispatcher routes `overrides.routes.api` to the wired applier
 *     (no "Domain routes not yet wired" warning).
 *   - The dispatcher routes `overrides.routes.pages` to the page-route
 *     composer and the manifest registries apply it.
 *   - `applyApiOverridesToManifests` drops disabled methods, drops fully
 *     disabled entries, and wraps `load()` for replacement handlers.
 *   - Programmatic overrides supersede `modules.ts` overrides.
 *   - `registerApiRouteManifests` consults the override composer.
 *   - Stale override keys emit a warning so operators notice.
 *
 * Spec: `.ai/specs/implemented/2026-05-04-modules-ts-unified-overrides.md`.
 */
import {
  applyApiOverridesToManifests,
  applyApiRouteOverrides,
  applyModuleOverridesFromEnabledModules,
  applyPageOverridesToManifests,
  applyPageRouteOverrides,
  composeApiRouteOverrides,
  composePageRouteOverrides,
  resetApiRouteOverridesForTests,
  resetModuleContractOverridesForTests,
  type ApiRouteOverridesMap,
} from '../overrides'
import { createLogger } from '@open-mercato/shared/lib/logger'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})
const loggerWarn = createLogger('shared').warn as jest.Mock
import {

  getApiRouteManifests,
  getBackendRouteManifests,
  getFrontendRouteManifests,
  registerApiRouteManifests,
  registerBackendRouteManifests,
  registerFrontendRouteManifests,
  type ApiHandler,
  type ApiRouteManifestEntry,
  type BackendRouteManifestEntry,
  type FrontendRouteManifestEntry,
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

function makeBackendPage(path: string): BackendRouteManifestEntry {
  return {
    moduleId: 'example',
    path,
    pattern: path,
    title: 'Original',
    load: jest.fn(async () => function OriginalPage() { return null }),
  }
}

function makeFrontendPage(path: string): FrontendRouteManifestEntry {
  return {
    moduleId: 'example',
    path,
    pattern: path,
    title: 'Original',
    load: jest.fn(async () => function OriginalPage() { return null }),
  }
}

beforeEach(() => {
  resetModuleContractOverridesForTests()
  resetApiRouteOverridesForTests()
  registerApiRouteManifests([])
  registerBackendRouteManifests([])
  registerFrontendRouteManifests([])
})

afterEach(() => {
  registerApiRouteManifests([])
  registerBackendRouteManifests([])
  registerFrontendRouteManifests([])
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

  it('matches public /api override keys against generated manifest paths', () => {
    const entries = [makeEntry('a', '/example/override-probe', ['GET', 'POST'])]
    const result = applyApiOverridesToManifests(entries, {
      'GET /api/example/override-probe': null,
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
    loggerWarn.mockClear()
    applyApiOverridesToManifests([makeEntry('a', '/api/foo', ['GET'])], {
      'GET /api/missing': null,
    })
    const staleCalls = loggerWarn.mock.calls.filter((args) =>
      typeof args[0] === 'string' && args[0].includes('did not match any registered API route'),
    )
    expect(staleCalls).toHaveLength(1)
    expect(staleCalls[0][1]).toEqual(expect.objectContaining({ key: 'GET /api/missing' }))
  })

  it('skips malformed override values (not null and not a definition)', () => {
    loggerWarn.mockClear()
    const entries = [makeEntry('a', '/api/foo', ['GET'])]
    const result = applyApiOverridesToManifests(entries, {
      // @ts-expect-error intentionally malformed
      'GET /api/foo': { metadata: { requireAuth: false } },
    })
    expect(result).toHaveLength(1)
    expect(result[0].methods).toEqual(['GET'])
    expect(loggerWarn).toHaveBeenCalled()
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
    loggerWarn.mockClear()
    applyApiRouteOverrides({
      'NOT_A_METHOD /api/foo': null,
      'GET': null,
      '': null,
    })
    expect(Object.keys(composeApiRouteOverrides())).toHaveLength(0)
    expect(loggerWarn.mock.calls.filter((c) =>
      typeof c[0] === 'string' && c[0].includes('malformed routes.api key'),
    )).toHaveLength(3)
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
    loggerWarn.mockClear()
    applyModuleOverridesFromEnabledModules([
      {
        id: 'app',
        overrides: { routes: { api: { 'GET /api/foo': null } } },
      },
    ])
    const unwiredCalls = loggerWarn.mock.calls.filter((args) =>
      typeof args[0] === 'string' && args[0].includes('not yet wired') && args[1]?.domain === 'routes',
    )
    expect(unwiredCalls).toHaveLength(0)
    expect(composeApiRouteOverrides()['GET /api/foo']).toBeNull()
  })

  it('routes `overrides.routes.pages` to the page override composer', () => {
    loggerWarn.mockClear()
    applyModuleOverridesFromEnabledModules([
      {
        id: 'first',
        overrides: {
          routes: {
            pages: {
              '/backend/foo': null,
              '/frontend/store': { metadata: { title: 'Store Override' } },
            },
          },
        },
      },
      {
        id: 'second',
        overrides: {
          routes: {
            pages: {
              '/backend/bar/': null,
            },
          },
        },
      },
    ])
    const unwiredCalls = loggerWarn.mock.calls.filter((args) =>
      typeof args[0] === 'string' && args[0].includes('not yet wired'),
    )
    expect(unwiredCalls).toHaveLength(0)
    expect(composePageRouteOverrides()).toMatchObject({
      'backend:/backend/foo': null,
      'backend:/backend/bar': null,
      'frontend:/store': { metadata: { title: 'Store Override' } },
    })
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
    loggerWarn.mockClear()
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
    expect(loggerWarn.mock.calls.filter((c) =>
      typeof c[0] === 'string' && c[0].includes('malformed routes.api key'),
    )).toHaveLength(1)
  })
})

describe('applyPageOverridesToManifests', () => {
  it('drops disabled backend pages and replaces metadata/loader for frontend pages', async () => {
    const Replacement = function ReplacementPage() { return null }
    const backendEntries = [
      makeBackendPage('/backend/example'),
      makeBackendPage('/backend/keep'),
    ]
    const frontendEntries = [
      makeFrontendPage('/store'),
    ]

    const backendResult = applyPageOverridesToManifests(backendEntries, {
      '/backend/example': null,
    }, 'backend')
    const frontendResult = applyPageOverridesToManifests(frontendEntries, {
      '/frontend/store': {
        Component: Replacement,
        metadata: { title: 'Store Override', navHidden: true },
      },
    }, 'frontend')

    expect(backendResult.map((entry) => entry.path)).toEqual(['/backend/keep'])
    expect(frontendResult).toHaveLength(1)
    expect(frontendResult[0].title).toBe('Store Override')
    expect(frontendResult[0].navHidden).toBe(true)
    await expect(frontendResult[0].load()).resolves.toBe(Replacement)
  })

  it('lets programmatic page overrides supersede modules.ts inline overrides', () => {
    applyModuleOverridesFromEnabledModules([
      {
        id: 'app',
        overrides: { routes: { pages: { '/backend/foo': null } } },
      },
    ])
    const loader = async () => function RestoredPage() { return null }
    applyPageRouteOverrides({
      '/backend/foo': { load: loader, metadata: { title: 'Restored' } },
    })

    const result = applyPageOverridesToManifests([makeBackendPage('/backend/foo')], composePageRouteOverrides(), 'backend')
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Restored')
    expect(result[0].load).toBe(loader)
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

describe('page manifest registries consult overrides', () => {
  it('applies backend and frontend page overrides at registration time', () => {
    applyModuleOverridesFromEnabledModules([
      {
        id: 'app',
        overrides: {
          routes: {
            pages: {
              '/backend/example': null,
              '/frontend/store': { metadata: { title: 'Store Override' } },
            },
          },
        },
      },
    ])

    registerBackendRouteManifests([
      makeBackendPage('/backend/example'),
      makeBackendPage('/backend/keep'),
    ])
    registerFrontendRouteManifests([
      makeFrontendPage('/store'),
    ])

    expect(getBackendRouteManifests().map((entry) => entry.path)).toEqual(['/backend/keep'])
    expect(getFrontendRouteManifests()).toHaveLength(1)
    expect(getFrontendRouteManifests()[0].title).toBe('Store Override')
  })
})
