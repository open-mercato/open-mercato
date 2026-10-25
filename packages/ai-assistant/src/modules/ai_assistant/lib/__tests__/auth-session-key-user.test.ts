import type { AwilixContainer } from 'awilix'

const findApiKeyBySecret = jest.fn()
const resolveVerifiedSessionKeyUserId = jest.fn()
const loadAcl = jest.fn()

jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  findApiKeyBySecret: (...args: unknown[]) => findApiKeyBySecret(...args),
}))
jest.mock('@open-mercato/core/modules/api_keys/services/sessionKeyRoles', () => ({
  resolveVerifiedSessionKeyUserId: (...args: unknown[]) => resolveVerifiedSessionKeyUserId(...args),
}))

import { authenticateMcpRequest } from '../auth'

const em = { persist: () => ({ flush: async () => undefined }) }
const container = {
  resolve: (name: string) => (name === 'em' ? em : name === 'rbacService' ? { loadAcl } : undefined),
} as unknown as AwilixContainer

describe('authenticateMcpRequest key principal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    loadAcl.mockResolvedValue({ isSuperAdmin: false, features: ['ai_assistant.view'], organizations: null })
    findApiKeyBySecret.mockResolvedValue({ id: 'key-1', name: 'key', tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('returns the verified user of a session-bound key', async () => {
    resolveVerifiedSessionKeyUserId.mockResolvedValue('user-1')
    const result = await authenticateMcpRequest('omk_key.secret', container)
    expect(result).toMatchObject({ success: true, keyId: 'key-1', userId: 'api_key:key-1', apiKeyUserId: 'user-1' })
  })

  it('returns no backing user for a regular key', async () => {
    resolveVerifiedSessionKeyUserId.mockResolvedValue(null)
    const result = await authenticateMcpRequest('omk_key.secret', container)
    expect(result).toMatchObject({ success: true, keyId: 'key-1' })
    expect(result).not.toHaveProperty('apiKeyUserId')
  })
})
