import type { Module, FrontendRouteManifestEntry, ApiRouteManifestEntry } from '../registry'
import {
  createLazyModuleSubscriber,
  createLazyModuleWorker,
  registerCliModules,
  getCliModules,
  getDefaultEncryptionMaps,
  hasCliModules,
  findFrontendMatch,
  findBackendMatch,
  findApi,
  matchRoutePattern,
  findRouteManifestMatch,
  findApiRouteManifestMatch,
  sortRoutesBySpecificity,
  registerFrontendRouteManifests,
  getFrontendRouteManifests,
} from '../registry'

describe('CLI Modules Registry', () => {
  // Clear the registry before each test
  beforeEach(() => {
    registerCliModules([])
  })

  afterEach(() => {
    registerCliModules([])
  })

  describe('registerCliModules', () => {
    it('should register modules', () => {
      const modules: Module[] = [
        { id: 'module-a' },
        { id: 'module-b' },
      ]

      registerCliModules(modules)

      expect(getCliModules()).toEqual(modules)
    })

    it('should overwrite previously registered modules', () => {
      const modules1: Module[] = [{ id: 'module-a' }]
      const modules2: Module[] = [{ id: 'module-b' }, { id: 'module-c' }]

      registerCliModules(modules1)
      expect(getCliModules().length).toBe(1)

      registerCliModules(modules2)
      expect(getCliModules().length).toBe(2)
      expect(getCliModules().map(m => m.id)).toEqual(['module-b', 'module-c'])
    })
  })

  describe('getCliModules', () => {
    it('should return empty array when no modules registered', () => {
      expect(getCliModules()).toEqual([])
    })

    it('should return registered modules', () => {
      const modules: Module[] = [
        { id: 'test-module', info: { name: 'Test Module' } },
      ]

      registerCliModules(modules)

      const result = getCliModules()
      expect(result.length).toBe(1)
      expect(result[0].id).toBe('test-module')
      expect(result[0].info?.name).toBe('Test Module')
    })
  })

  describe('hasCliModules', () => {
    it('should return false when no modules registered', () => {
      expect(hasCliModules()).toBe(false)
    })

    it('should return false for empty array', () => {
      registerCliModules([])
      expect(hasCliModules()).toBe(false)
    })

    it('should return true when modules are registered', () => {
      registerCliModules([{ id: 'some-module' }])
      expect(hasCliModules()).toBe(true)
    })
  })

  describe('getDefaultEncryptionMaps', () => {
    it('collects per-module encryption maps', () => {
      const maps = getDefaultEncryptionMaps([
        {
          id: 'auth',
          defaultEncryptionMaps: [
            { entityId: 'auth:user', fields: [{ field: 'email', hashField: 'email_hash' }] },
          ],
        },
        {
          id: 'customers',
          defaultEncryptionMaps: [
            { entityId: 'customers:customer_comment', fields: [{ field: 'body' }] },
          ],
        },
      ])

      expect(maps).toEqual([
        { entityId: 'auth:user', fields: [{ field: 'email', hashField: 'email_hash' }] },
        { entityId: 'customers:customer_comment', fields: [{ field: 'body', hashField: null }] },
      ])
    })

    it('throws on duplicate entity registrations', () => {
      expect(() => getDefaultEncryptionMaps([
        {
          id: 'module-a',
          defaultEncryptionMaps: [{ entityId: 'auth:user', fields: [{ field: 'email' }] }],
        },
        {
          id: 'module-b',
          defaultEncryptionMaps: [{ entityId: 'auth:user', fields: [{ field: 'email_hash' }] }],
        },
      ])).toThrow('Duplicate default encryption map')
    })
  })

  describe('findFrontendMatch', () => {
    it('should match simple routes', () => {
      const modules: Module[] = [
        {
          id: 'test',
          frontendRoutes: [
            {
              pattern: '/dashboard',
              Component: () => null,
            },
          ],
        },
      ]

      const result = findFrontendMatch(modules, '/dashboard')
      expect(result).toBeDefined()
      expect(result?.params).toEqual({})
    })

    it('should match dynamic routes', () => {
      const modules: Module[] = [
        {
          id: 'test',
          frontendRoutes: [
            {
              pattern: '/users/[id]',
              Component: () => null,
            },
          ],
        },
      ]

      const result = findFrontendMatch(modules, '/users/123')
      expect(result).toBeDefined()
      expect(result?.params).toEqual({ id: '123' })
    })

    it('should match catch-all routes', () => {
      const modules: Module[] = [
        {
          id: 'test',
          frontendRoutes: [
            {
              pattern: '/docs/[...slug]',
              Component: () => null,
            },
          ],
        },
      ]

      const result = findFrontendMatch(modules, '/docs/api/getting-started')
      expect(result).toBeDefined()
      expect(result?.params).toEqual({ slug: ['api', 'getting-started'] })
    })

    it('should return undefined for non-matching routes', () => {
      const modules: Module[] = [
        {
          id: 'test',
          frontendRoutes: [
            {
              pattern: '/dashboard',
              Component: () => null,
            },
          ],
        },
      ]

      const result = findFrontendMatch(modules, '/settings')
      expect(result).toBeUndefined()
    })

    it('should match static segments case-insensitively (issue #1559)', () => {
      const modules: Module[] = [
        {
          id: 'auth',
          frontendRoutes: [
            {
              pattern: '/login',
              Component: () => null,
            },
          ],
        },
      ]

      expect(findFrontendMatch(modules, '/lOgin')).toBeDefined()
      expect(findFrontendMatch(modules, '/LOGIN')).toBeDefined()
      expect(findFrontendMatch(modules, '/Login')).toBeDefined()
    })

    it('should preserve dynamic param case', () => {
      const modules: Module[] = [
        {
          id: 'test',
          frontendRoutes: [
            {
              pattern: '/users/[id]',
              Component: () => null,
            },
          ],
        },
      ]

      const result = findFrontendMatch(modules, '/Users/JohnSmith')
      expect(result).toBeDefined()
      expect(result?.params).toEqual({ id: 'JohnSmith' })
    })
  })

  describe('matchRoutePattern', () => {
    it('matches multi-segment static patterns case-insensitively', () => {
      expect(matchRoutePattern('/backend/customers/people', '/Backend/Customers/PEOPLE')).toEqual({})
    })

    it('matches mixed static + dynamic patterns and preserves dynamic case', () => {
      expect(matchRoutePattern('/users/[id]/edit', '/USERS/AbC123/Edit')).toEqual({ id: 'AbC123' })
    })

    it('preserves catch-all segment case', () => {
      expect(matchRoutePattern('/docs/[...slug]', '/Docs/API/Getting-Started')).toEqual({
        slug: ['API', 'Getting-Started'],
      })
    })

    it('returns undefined when static segments do not match even case-insensitively', () => {
      expect(matchRoutePattern('/login', '/sign-in')).toBeUndefined()
    })
  })

  describe('findBackendMatch', () => {
    it('should match backend routes', () => {
      const modules: Module[] = [
        {
          id: 'test',
          backendRoutes: [
            {
              pattern: '/backend/settings',
              Component: () => null,
            },
          ],
        },
      ]

      const result = findBackendMatch(modules, '/backend/settings')
      expect(result).toBeDefined()
    })

    it('should match dynamic backend routes', () => {
      const modules: Module[] = [
        {
          id: 'test',
          backendRoutes: [
            {
              pattern: '/backend/users/[id]/edit',
              Component: () => null,
            },
          ],
        },
      ]

      const result = findBackendMatch(modules, '/backend/users/456/edit')
      expect(result).toBeDefined()
      expect(result?.params).toEqual({ id: '456' })
    })
  })

  describe('findApi', () => {
    it('should find API handlers by method and path', () => {
      const mockHandler = async () => new Response('OK')
      const modules: Module[] = [
        {
          id: 'test',
          apis: [
            {
              path: '/users',
              handlers: {
                GET: mockHandler,
                POST: mockHandler,
              },
            },
          ],
        },
      ]

      const getResult = findApi(modules, 'GET', '/users')
      expect(getResult).toBeDefined()
      expect(getResult?.handler).toBe(mockHandler)

      const postResult = findApi(modules, 'POST', '/users')
      expect(postResult).toBeDefined()

      const deleteResult = findApi(modules, 'DELETE', '/users')
      expect(deleteResult).toBeUndefined()
    })

    it('should match dynamic API paths', () => {
      const mockHandler = async () => new Response('OK')
      const modules: Module[] = [
        {
          id: 'test',
          apis: [
            {
              path: '/users/[id]',
              handlers: {
                GET: mockHandler,
              },
            },
          ],
        },
      ]

      const result = findApi(modules, 'GET', '/users/123')
      expect(result).toBeDefined()
      expect(result?.params).toEqual({ id: '123' })
    })

    it('should include requireAuth and requireRoles', () => {
      const mockHandler = async () => new Response('OK')
      const modules: Module[] = [
        {
          id: 'test',
          apis: [
            {
              path: '/admin',
              handlers: { GET: mockHandler },
              requireAuth: true,
              requireRoles: ['admin'],
            },
          ],
        },
      ]

      const result = findApi(modules, 'GET', '/admin')
      expect(result).toBeDefined()
      expect(result?.requireAuth).toBe(true)
      expect(result?.requireRoles).toEqual(['admin'])
    })
  })
})

describe('Module type with workers', () => {
  it('should allow workers property on Module', () => {
    const module: Module = {
      id: 'test-module',
      workers: [
        {
          id: 'test:worker',
          queue: 'test-queue',
          concurrency: 2,
          handler: async () => {},
        },
      ],
    }

    expect(module.workers).toBeDefined()
    expect(module.workers?.length).toBe(1)
    expect(module.workers?.[0].queue).toBe('test-queue')
  })

  it('should allow subscribers property on Module', () => {
    const module: Module = {
      id: 'test-module',
      subscribers: [
        {
          id: 'test:subscriber',
          event: 'user.created',
          handler: async () => {},
        },
      ],
    }

    expect(module.subscribers).toBeDefined()
    expect(module.subscribers?.length).toBe(1)
    expect(module.subscribers?.[0].event).toBe('user.created')
  })
})

describe('Lazy module handlers', () => {
  it('loads subscriber handlers lazily and caches the module', async () => {
    const handler = jest.fn(async () => undefined)
    const loadModule = jest.fn(async () => ({ default: handler }))
    const lazyHandler = createLazyModuleSubscriber(loadModule, 'subscriber:test')

    await lazyHandler({ value: 1 }, { ctx: true })
    await lazyHandler({ value: 2 }, { ctx: true })

    expect(loadModule).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('loads worker handlers lazily and caches the module', async () => {
    const handler = jest.fn(async () => undefined)
    const loadModule = jest.fn(async () => ({ default: handler }))
    const lazyHandler = createLazyModuleWorker(loadModule, 'worker:test')

    await lazyHandler({ payload: 1 }, { ctx: true })
    await lazyHandler({ payload: 2 }, { ctx: true })

    expect(loadModule).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledTimes(2)
  })
})

describe('sortRoutesBySpecificity', () => {
  function routes(patterns: string[]) {
    return patterns.map((p) => ({ pattern: p }))
  }

  it('places literal segments before dynamic segments', () => {
    const sorted = sortRoutesBySpecificity(routes(['/things/[id]', '/things/new']))
    expect(sorted.map((r) => r.pattern)).toEqual(['/things/new', '/things/[id]'])
  })

  it('places dynamic segments before catch-all segments', () => {
    const sorted = sortRoutesBySpecificity(routes(['/docs/[...slug]', '/docs/[id]']))
    expect(sorted.map((r) => r.pattern)).toEqual(['/docs/[id]', '/docs/[...slug]'])
  })

  it('places literal before catch-all segments', () => {
    const sorted = sortRoutesBySpecificity(routes(['/docs/[...slug]', '/docs/intro']))
    expect(sorted.map((r) => r.pattern)).toEqual(['/docs/intro', '/docs/[...slug]'])
  })

  it('handles multi-segment patterns with mixed specificity', () => {
    const sorted = sortRoutesBySpecificity(routes([
      '/[orgSlug]/portal/case-studies/[id]',
      '/[orgSlug]/portal/case-studies/new',
      '/[orgSlug]/portal/case-studies',
    ]))
    expect(sorted.map((r) => r.pattern)).toEqual([
      '/[orgSlug]/portal/case-studies',
      '/[orgSlug]/portal/case-studies/new',
      '/[orgSlug]/portal/case-studies/[id]',
    ])
  })

  it('treats optional catch-all [[...slug]] as least specific', () => {
    const sorted = sortRoutesBySpecificity(routes(['/[[...slug]]', '/[id]', '/new']))
    expect(sorted.map((r) => r.pattern)).toEqual(['/new', '/[id]', '/[[...slug]]'])
  })

  it('is stable — does not reorder equally specific routes', () => {
    const input = routes(['/a', '/b', '/c'])
    const sorted = sortRoutesBySpecificity(input)
    expect(sorted.map((r) => r.pattern)).toEqual(['/a', '/b', '/c'])
  })

  it('falls back to path when pattern is absent', () => {
    const input = [{ path: '/things/[id]' }, { path: '/things/new' }]
    const sorted = sortRoutesBySpecificity(input)
    expect(sorted.map((r) => r.path)).toEqual(['/things/new', '/things/[id]'])
  })
})

describe('findRouteManifestMatch — specificity (issue #1870)', () => {
  function entry(pattern: string): FrontendRouteManifestEntry {
    return { pattern, moduleId: 'test', load: async () => () => null }
  }

  it('returns the literal route when a literal and a dynamic route both match', () => {
    const routes = sortRoutesBySpecificity([entry('/things/[id]'), entry('/things/new')])
    const match = findRouteManifestMatch(routes, '/things/new')
    expect(match?.route.pattern).toBe('/things/new')
  })

  it('returns the dynamic route when only the dynamic route matches', () => {
    const routes = sortRoutesBySpecificity([entry('/things/[id]'), entry('/things/new')])
    const match = findRouteManifestMatch(routes, '/things/abc-123')
    expect(match?.route.pattern).toBe('/things/[id]')
    expect(match?.params).toEqual({ id: 'abc-123' })
  })

  it('picks literal over catch-all', () => {
    const routes = sortRoutesBySpecificity([entry('/docs/[...slug]'), entry('/docs/intro')])
    const match = findRouteManifestMatch(routes, '/docs/intro')
    expect(match?.route.pattern).toBe('/docs/intro')
  })

  it('picks dynamic over catch-all', () => {
    const routes = sortRoutesBySpecificity([entry('/docs/[...slug]'), entry('/docs/[id]')])
    const match = findRouteManifestMatch(routes, '/docs/getting-started')
    expect(match?.route.pattern).toBe('/docs/[id]')
  })

  // Direct-consumer tests — the Next.js catch-all `[...slug]` pages import
  // `frontendRoutes`/`backendRoutes` from the generated manifests and pass them
  // straight to `findRouteManifestMatch` without going through
  // `register*RouteManifests` first. These tests pin that path: the matcher
  // must sort internally so the user-facing bug from issue #1870 stays fixed.
  it('picks the literal route from an unsorted (literal-after-dynamic) array', () => {
    const unsorted = [entry('/things/[id]'), entry('/things/new')]
    const match = findRouteManifestMatch(unsorted, '/things/new')
    expect(match?.route.pattern).toBe('/things/new')
  })

  it('picks the literal route from an unsorted (catch-all-after-literal) array', () => {
    const unsorted = [entry('/docs/[...slug]'), entry('/docs/intro')]
    const match = findRouteManifestMatch(unsorted, '/docs/intro')
    expect(match?.route.pattern).toBe('/docs/intro')
  })

  it('still picks dynamic over catch-all when input is unsorted', () => {
    const unsorted = [entry('/docs/[...slug]'), entry('/docs/[id]')]
    const match = findRouteManifestMatch(unsorted, '/docs/getting-started')
    expect(match?.route.pattern).toBe('/docs/[id]')
  })
})

describe('findApiRouteManifestMatch — specificity (issue #1870)', () => {
  function apiEntry(path: string): ApiRouteManifestEntry {
    return { path, moduleId: 'test', kind: 'route-file', methods: ['GET'], load: async () => ({}) }
  }

  it('returns the literal API route over the dynamic one', () => {
    const routes = sortRoutesBySpecificity([apiEntry('/api/things/[id]'), apiEntry('/api/things/new')])
    const match = findApiRouteManifestMatch(routes, 'GET', '/api/things/new')
    expect(match?.route.path).toBe('/api/things/new')
  })

  it('returns the dynamic API route when only it matches', () => {
    const routes = sortRoutesBySpecificity([apiEntry('/api/things/[id]'), apiEntry('/api/things/new')])
    const match = findApiRouteManifestMatch(routes, 'GET', '/api/things/abc-123')
    expect(match?.route.path).toBe('/api/things/[id]')
  })

  // Direct-consumer test mirroring the API catch-all `/app/api/[...slug]/route.ts`:
  // generated `apiRoutes` is passed to the matcher without first calling
  // `registerApiRouteManifests`. Matcher must sort internally.
  it('picks the literal API route from an unsorted array', () => {
    const unsorted = [apiEntry('/api/things/[id]'), apiEntry('/api/things/new')]
    const match = findApiRouteManifestMatch(unsorted, 'GET', '/api/things/new')
    expect(match?.route.path).toBe('/api/things/new')
  })
})

describe('registerFrontendRouteManifests — sorts on registration (issue #1870)', () => {
  function entry(pattern: string): FrontendRouteManifestEntry {
    return { pattern, moduleId: 'test', load: async () => () => null }
  }

  afterEach(() => {
    registerFrontendRouteManifests([])
  })

  it('stores routes pre-sorted by specificity so first-match-wins works correctly', () => {
    registerFrontendRouteManifests([entry('/things/[id]'), entry('/things/new')])
    const stored = getFrontendRouteManifests()
    expect(stored[0].pattern).toBe('/things/new')
    expect(stored[1].pattern).toBe('/things/[id]')
  })
})
