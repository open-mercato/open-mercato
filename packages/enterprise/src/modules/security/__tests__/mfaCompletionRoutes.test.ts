import { isMfaPendingAccessAllowed, listMfaPendingAccessRoutes } from '@open-mercato/shared/lib/auth/mfaPendingAccess'

describe('security module mfa completion route registration', () => {
  it('registers the canonical completion routes at module load, before any authentication runs', async () => {
    await import('../lib/mfaCompletionRoutes')

    expect(isMfaPendingAccessAllowed('POST', '/api/security/mfa/prepare')).toBe(true)
    expect(isMfaPendingAccessAllowed('POST', '/api/security/mfa/verify')).toBe(true)
    expect(isMfaPendingAccessAllowed('POST', '/api/security/mfa/recovery')).toBe(true)
    expect(isMfaPendingAccessAllowed('GET', '/api/security/mfa/verify')).toBe(false)
    expect(isMfaPendingAccessAllowed('POST', '/api/customers/people')).toBe(false)
    expect(isMfaPendingAccessAllowed('POST', '/api/security/mfa/methods')).toBe(false)

    const paths = listMfaPendingAccessRoutes().map((route) => route.path)
    expect(paths).toEqual([
      '/api/security/mfa/prepare',
      '/api/security/mfa/recovery',
      '/api/security/mfa/verify',
    ])
  })

  it('is idempotent — re-registering never duplicates or widens entries', async () => {
    const { registerCanonicalMfaCompletionRoutes } = await import('../lib/mfaCompletionRoutes')
    const before = listMfaPendingAccessRoutes()

    registerCanonicalMfaCompletionRoutes()
    registerCanonicalMfaCompletionRoutes()

    expect(listMfaPendingAccessRoutes()).toEqual(before)
  })
})
