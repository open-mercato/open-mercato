import {
  executePageMiddleware,
  resolvePageMiddlewareRedirect,
} from '@open-mercato/shared/lib/middleware/page-executor'
import {
  CONTINUE_PAGE_MIDDLEWARE,
  matchPageMiddlewareTarget,
  type PageMiddlewareContext,
  type PageMiddlewareRegistryEntry,
} from '@open-mercato/shared/modules/middleware/page'

function buildContext(overrides?: Partial<PageMiddlewareContext>): PageMiddlewareContext {
  return {
    pathname: '/backend/customers/people',
    mode: 'backend',
    routeMeta: { requireAuth: true },
    auth: {
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      roles: ['admin'],
    },
    ensureContainer: async () => ({ resolve: () => null }),
    ...overrides,
  }
}

describe('matchPageMiddlewareTarget', () => {
  it('matches exact string targets', () => {
    expect(matchPageMiddlewareTarget('/backend', '/backend')).toBe(true)
    expect(matchPageMiddlewareTarget('/backend/customers', '/backend')).toBe(false)
  })

  it('matches wildcard prefix targets', () => {
    expect(matchPageMiddlewareTarget('/backend/customers', '/backend/*')).toBe(true)
    expect(matchPageMiddlewareTarget('/frontend/home', '/backend/*')).toBe(false)
  })

  it('matches regexp targets', () => {
    expect(matchPageMiddlewareTarget('/backend/customers', /^\/backend\/.+$/)).toBe(true)
    expect(matchPageMiddlewareTarget('/backend', /^\/backend\/.+$/)).toBe(false)
  })
})

describe('executePageMiddleware', () => {
  it('returns continue when no middleware matches', async () => {
    const entries: PageMiddlewareRegistryEntry[] = [
      {
        moduleId: 'security',
        middleware: [
          {
            id: 'security.frontend',
            mode: 'frontend',
            target: '/frontend/*',
            run: async () => CONTINUE_PAGE_MIDDLEWARE,
          },
        ],
      },
    ]

    await expect(executePageMiddleware({ entries, context: buildContext() })).resolves.toEqual(
      CONTINUE_PAGE_MIDDLEWARE,
    )
  })

  it('applies deterministic priority ordering and short-circuits on redirect', async () => {
    const calls: string[] = []
    const entries: PageMiddlewareRegistryEntry[] = [
      {
        moduleId: 'mod-a',
        middleware: [
          {
            id: 'mod-a.first',
            mode: 'backend',
            target: '/backend/*',
            priority: 20,
            run: async () => {
              calls.push('mod-a.first')
              return CONTINUE_PAGE_MIDDLEWARE
            },
          },
          {
            id: 'mod-a.third',
            mode: 'backend',
            target: '/backend/*',
            priority: 30,
            run: async () => {
              calls.push('mod-a.third')
              return CONTINUE_PAGE_MIDDLEWARE
            },
          },
        ],
      },
      {
        moduleId: 'mod-b',
        middleware: [
          {
            id: 'mod-b.second',
            mode: 'backend',
            target: '/backend/*',
            priority: 25,
            run: async () => {
              calls.push('mod-b.second')
              return { action: 'redirect', location: '/backend/profile/security/mfa' } as const
            },
          },
        ],
      },
    ]

    await expect(
      executePageMiddleware({ entries, context: buildContext() }),
    ).resolves.toEqual({ action: 'redirect', location: '/backend/profile/security/mfa' })
    expect(calls).toEqual(['mod-a.first', 'mod-b.second'])
  })

  it('throws and emits error callback on middleware failure', async () => {
    const onError = jest.fn()
    const entries: PageMiddlewareRegistryEntry[] = [
      {
        moduleId: 'mod-a',
        middleware: [
          {
            id: 'mod-a.fail',
            mode: 'backend',
            target: '/backend/*',
            run: async () => {
              throw new Error('boom')
            },
          },
        ],
      },
    ]

    await expect(
      executePageMiddleware({ entries, context: buildContext(), onError }),
    ).rejects.toThrow('boom')
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { id: 'mod-a.fail', priority: undefined })
  })
})

describe('resolvePageMiddlewareRedirect', () => {
  it('returns redirect location for first terminal middleware', async () => {
    const entries: PageMiddlewareRegistryEntry[] = [
      {
        moduleId: 'mod-a',
        middleware: [
          {
            id: 'mod-a.redirect',
            target: '/backend/*',
            run: async () => ({ action: 'redirect', location: '/backend/profile/security/mfa' }),
          },
        ],
      },
    ]

    await expect(resolvePageMiddlewareRedirect({ entries, context: buildContext() })).resolves.toBe(
      '/backend/profile/security/mfa',
    )
  })
})
