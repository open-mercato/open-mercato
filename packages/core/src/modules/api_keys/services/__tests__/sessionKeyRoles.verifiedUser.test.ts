import type { EntityManager } from '@mikro-orm/postgresql'
import { ApiKey } from '../../data/entities'
import { resolveVerifiedSessionKeyUserId } from '../sessionKeyRoles'

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: jest.fn(),
}))

const em = { name: 'session-user-em' } as unknown as EntityManager

function makeKey(overrides: Partial<ApiKey>): ApiKey {
  return Object.assign(new ApiKey(), {
    id: 'key-1', tenantId: 'tenant-1', organizationId: 'org-1', createdBy: 'creator-1', deletedAt: null,
    ...overrides,
  })
}

describe('resolveVerifiedSessionKeyUserId', () => {
  beforeEach(() => {
    mockFindOneWithDecryption.mockReset()
  })

  it('returns null for a regular key without looking up its creator', async () => {
    await expect(resolveVerifiedSessionKeyUserId(em, makeKey({}))).resolves.toBeNull()
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  it('returns the session user after verifying it as API-key authentication does', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' })
    const key = makeKey({ sessionUserId: 'user-1', sessionTokenHash: 'hash' })

    await expect(resolveVerifiedSessionKeyUserId(em, key)).resolves.toBe('user-1')
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      em,
      expect.anything(),
      { id: 'user-1', deletedAt: null, isConfirmed: true, tenantId: 'tenant-1', organizationId: 'org-1' },
      { refresh: true },
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('returns null when the session user is deleted, unconfirmed or outside the key scope', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)
    const key = makeKey({ sessionUserId: 'user-1', sessionTokenHash: 'hash' })
    await expect(resolveVerifiedSessionKeyUserId(em, key)).resolves.toBeNull()

    mockFindOneWithDecryption.mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-2' })
    await expect(resolveVerifiedSessionKeyUserId(em, key)).resolves.toBeNull()
  })

  it('returns null for a session-bound key that names no user', async () => {
    await expect(resolveVerifiedSessionKeyUserId(em, makeKey({ sessionTokenHash: 'hash' }))).resolves.toBeNull()
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })
})
