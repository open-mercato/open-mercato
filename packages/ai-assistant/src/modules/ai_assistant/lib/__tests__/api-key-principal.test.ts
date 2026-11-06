import type { AwilixContainer } from 'awilix'

const findOneWithDecryption = jest.fn()
const resolveVerifiedSessionKeyUserId = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))
jest.mock('@open-mercato/core/modules/api_keys/data/entities', () => ({ ApiKey: class ApiKeyStub {} }))
jest.mock('@open-mercato/core/modules/api_keys/services/sessionKeyRoles', () => ({
  resolveVerifiedSessionKeyUserId: (...args: unknown[]) => resolveVerifiedSessionKeyUserId(...args),
}))

import { resolveRequestApiKeyPrincipal } from '../api-key-principal'

const em = { name: 'principal-em' }
const container = { resolve: () => em } as unknown as AwilixContainer
const keyAuth = { sub: 'api_key:key-1', isApiKey: true, keyId: 'key-1', userId: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' }

describe('resolveRequestApiKeyPrincipal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns no key principal for a cookie session', async () => {
    await expect(resolveRequestApiKeyPrincipal(container, { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })).resolves.toEqual({})
    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })

  it('returns the key id alone for a regular key, ignoring its creator', async () => {
    const key = { id: 'key-1' }
    findOneWithDecryption.mockResolvedValue(key)
    resolveVerifiedSessionKeyUserId.mockResolvedValue(null)

    await expect(resolveRequestApiKeyPrincipal(container, keyAuth)).resolves.toEqual({ apiKeyId: 'key-1' })
    expect(findOneWithDecryption).toHaveBeenCalledWith(em, expect.anything(), { id: 'key-1', deletedAt: null }, undefined, { tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(resolveVerifiedSessionKeyUserId).toHaveBeenCalledWith(em, key)
  })

  it('adds the verified user of a session-bound key', async () => {
    findOneWithDecryption.mockResolvedValue({ id: 'key-1' })
    resolveVerifiedSessionKeyUserId.mockResolvedValue('user-1')

    await expect(resolveRequestApiKeyPrincipal(container, keyAuth)).resolves.toEqual({ apiKeyId: 'key-1', apiKeyUserId: 'user-1' })
  })

  it('keeps the key id when the key row is gone', async () => {
    findOneWithDecryption.mockResolvedValue(null)

    await expect(resolveRequestApiKeyPrincipal(container, keyAuth)).resolves.toEqual({ apiKeyId: 'key-1' })
    expect(resolveVerifiedSessionKeyUserId).not.toHaveBeenCalled()
  })
})
