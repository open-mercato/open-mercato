import {
  isMfaPendingAccessAllowed,
  listMfaPendingAccessRoutes,
  registerMfaPendingAccessRoutes,
} from '../mfaPendingAccess'

describe('mfaPendingAccess', () => {
  it('allows the three canonical MFA completion routes for POST only', () => {
    expect(isMfaPendingAccessAllowed('POST', '/api/security/mfa/prepare')).toBe(true)
    expect(isMfaPendingAccessAllowed('POST', '/api/security/mfa/verify')).toBe(true)
    expect(isMfaPendingAccessAllowed('POST', '/api/security/mfa/recovery')).toBe(true)
    expect(isMfaPendingAccessAllowed('GET', '/api/security/mfa/verify')).toBe(false)
    expect(isMfaPendingAccessAllowed('PUT', '/api/security/mfa/prepare')).toBe(false)
    expect(isMfaPendingAccessAllowed('post', '/api/security/mfa/verify')).toBe(true)
  })

  it('rejects every other path', () => {
    expect(isMfaPendingAccessAllowed('POST', '/api/customers/people')).toBe(false)
    expect(isMfaPendingAccessAllowed('POST', '/api/security/mfa/verify/impersonate')).toBe(false)
    expect(isMfaPendingAccessAllowed('POST', '/api/auth/login')).toBe(false)
    expect(isMfaPendingAccessAllowed('POST', '/api/security/mfa/recovery-codes')).toBe(false)
    expect(isMfaPendingAccessAllowed('POST', '/api/security/mfa/prepare/')).toBe(true)
  })

  it('is fail-closed on missing or malformed input', () => {
    expect(isMfaPendingAccessAllowed(undefined, '/api/security/mfa/verify')).toBe(false)
    expect(isMfaPendingAccessAllowed(null, '/api/security/mfa/verify')).toBe(false)
    expect(isMfaPendingAccessAllowed('', '')).toBe(false)
    expect(isMfaPendingAccessAllowed('POST', undefined)).toBe(false)
    expect(isMfaPendingAccessAllowed('POST', 'not-a-path')).toBe(false)
  })

  it('registers additional completion routes additively and idempotently', () => {
    const routeCountBefore = listMfaPendingAccessRoutes().length

    registerMfaPendingAccessRoutes([
      { path: '/api/vendor/mfa/complete', methods: ['post', 'POST'] },
    ])
    expect(isMfaPendingAccessAllowed('POST', '/api/vendor/mfa/complete')).toBe(true)

    registerMfaPendingAccessRoutes([
      { path: '/api/vendor/mfa/complete/', methods: ['POST'] },
    ])
    const routeCountAfter = listMfaPendingAccessRoutes().length
    expect(routeCountAfter).toBe(routeCountBefore + 1)

    registerMfaPendingAccessRoutes([
      { path: 'no-leading-slash', methods: [] },
      { path: '/api/broken', methods: [] },
    ] as never)
    expect(listMfaPendingAccessRoutes().length).toBe(routeCountAfter)
    expect(isMfaPendingAccessAllowed('POST', '/api/broken')).toBe(false)
  })
})
