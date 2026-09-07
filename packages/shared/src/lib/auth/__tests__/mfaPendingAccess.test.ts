import {
  isMfaPendingAccessAllowed,
  listMfaPendingAccessRoutes,
  registerMfaPendingAccessRoutes,
} from '../mfaPendingAccess'

describe('mfaPendingAccess', () => {
  it('ships an empty generic registry and denies unknown routes by default', () => {
    const registeredPaths = listMfaPendingAccessRoutes().map((route) => route.path)
    expect(registeredPaths).not.toContain('/api/acme-mfa/complete')
    expect(isMfaPendingAccessAllowed('POST', '/api/acme-mfa/complete')).toBe(false)
    expect(isMfaPendingAccessAllowed('GET', '/api/customers/people')).toBe(false)
  })

  it('allows registered completion routes for their exact methods only', () => {
    registerMfaPendingAccessRoutes([{ path: '/api/acme-mfa/t2/verify', methods: ['POST'] }])

    expect(isMfaPendingAccessAllowed('POST', '/api/acme-mfa/t2/verify')).toBe(true)
    expect(isMfaPendingAccessAllowed('post', '/api/acme-mfa/t2/verify')).toBe(true)
    expect(isMfaPendingAccessAllowed('POST', '/api/acme-mfa/t2/verify/')).toBe(true)
    expect(isMfaPendingAccessAllowed('GET', '/api/acme-mfa/t2/verify')).toBe(false)
    expect(isMfaPendingAccessAllowed('PUT', '/api/acme-mfa/t2/verify')).toBe(false)
  })

  it('rejects unregistered paths and near-misses', () => {
    registerMfaPendingAccessRoutes([{ path: '/api/acme-mfa/t3/recovery', methods: ['POST'] }])

    expect(isMfaPendingAccessAllowed('POST', '/api/customers/people')).toBe(false)
    expect(isMfaPendingAccessAllowed('POST', '/api/acme-mfa/t3/unrelated')).toBe(false)
    expect(isMfaPendingAccessAllowed('POST', '/api/acme-mfa/t3/recovery/impersonate')).toBe(false)
    expect(isMfaPendingAccessAllowed('POST', '/api/auth/login')).toBe(false)
    expect(isMfaPendingAccessAllowed('POST', '/api/acme-mfa/t3/recovery-codes')).toBe(false)
  })

  it('is fail-closed on missing or malformed input', () => {
    registerMfaPendingAccessRoutes([{ path: '/api/acme-mfa/t4/complete', methods: ['POST'] }])

    expect(isMfaPendingAccessAllowed(undefined, '/api/acme-mfa/t4/complete')).toBe(false)
    expect(isMfaPendingAccessAllowed(null, '/api/acme-mfa/t4/complete')).toBe(false)
    expect(isMfaPendingAccessAllowed('', '')).toBe(false)
    expect(isMfaPendingAccessAllowed('POST', undefined)).toBe(false)
    expect(isMfaPendingAccessAllowed('POST', 'not-a-path')).toBe(false)
  })

  it('registers additional routes additively and idempotently', () => {
    const routeCountBefore = listMfaPendingAccessRoutes().length

    registerMfaPendingAccessRoutes([
      { path: '/api/acme-mfa/t5/complete', methods: ['post', 'POST'] },
    ])
    expect(isMfaPendingAccessAllowed('POST', '/api/acme-mfa/t5/complete')).toBe(true)

    registerMfaPendingAccessRoutes([
      { path: '/api/acme-mfa/t5/complete/', methods: ['POST'] },
      { path: '/api/acme-mfa/t5/complete', methods: ['GET'] },
    ])
    const merged = listMfaPendingAccessRoutes().find((route) => route.path === '/api/acme-mfa/t5/complete')
    expect(merged).toBeDefined()
    expect(merged?.methods).toEqual(['GET', 'POST'])
    expect(listMfaPendingAccessRoutes()).toHaveLength(routeCountBefore + 1)

    registerMfaPendingAccessRoutes([
      { path: 'no-leading-slash', methods: [] },
      { path: '/api/acme-mfa/t5/broken', methods: [] },
    ] as never)
    expect(listMfaPendingAccessRoutes()).toHaveLength(routeCountBefore + 1)
    expect(isMfaPendingAccessAllowed('POST', '/api/acme-mfa/t5/broken')).toBe(false)
  })
})
