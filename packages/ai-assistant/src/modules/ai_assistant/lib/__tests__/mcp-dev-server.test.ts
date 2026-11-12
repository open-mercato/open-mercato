import { buildDevToolContext, isMatchingApiKey } from '../mcp-dev-server'

describe('buildDevToolContext', () => {
  const authResult = {
    success: true as const, tenantId: 'tenant-1', organizationId: 'org-1', userId: 'creator-1',
    keyId: 'key-1', features: [], isSuperAdmin: false,
  }

  test('carries the key so a regular key is evaluated as the key', () => {
    const context = buildDevToolContext(authResult as never, {} as never, 'omk_secret', 'session-1')
    expect(context).toMatchObject({ apiKeyId: 'key-1', sessionId: 'session-1' })
    expect(context).not.toHaveProperty('apiKeyUserId')
  })

  test('carries the verified user of a session key', () => {
    const context = buildDevToolContext({ ...authResult, apiKeyUserId: 'user-1' } as never, {} as never, 'omk_secret', 'session-1')
    expect(context).toMatchObject({ apiKeyId: 'key-1', apiKeyUserId: 'user-1' })
  })
})

describe('isMatchingApiKey', () => {
  test('accepts an exact match', () => {
    expect(isMatchingApiKey('omk_secret-key', 'omk_secret-key')).toBe(true)
  })

  test('rejects a mismatched key of the same length', () => {
    expect(isMatchingApiKey('omk_secret-key', 'omk_secret-kex')).toBe(false)
  })

  test('rejects a shorter or longer provided value without throwing', () => {
    expect(isMatchingApiKey('omk_secret-key', 'omk_secret-ke')).toBe(false)
    expect(isMatchingApiKey('omk_secret-key', 'omk_secret-key-extra')).toBe(false)
  })

  test('rejects an empty provided value', () => {
    expect(isMatchingApiKey('omk_secret-key', '')).toBe(false)
  })
})
