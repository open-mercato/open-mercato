import type { Module } from '../registry'
import {
  registerCliModules,
  getCliModules,
  hasCliModules,
  findFrontendMatch,
  findBackendMatch,
  findApi,
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
    const testModule: Module = {
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

    expect(testModule.workers).toBeDefined()
    expect(testModule.workers?.length).toBe(1)
    expect(testModule.workers?.[0].queue).toBe('test-queue')
  })

  it('should allow subscribers property on Module', () => {
    const testModule: Module = {
      id: 'test-module',
      subscribers: [
        {
          id: 'test:subscriber',
          event: 'user.created',
          handler: async () => {},
        },
      ],
    }

    expect(testModule.subscribers).toBeDefined()
    expect(testModule.subscribers?.length).toBe(1)
    expect(testModule.subscribers?.[0].event).toBe('user.created')
  })
})
