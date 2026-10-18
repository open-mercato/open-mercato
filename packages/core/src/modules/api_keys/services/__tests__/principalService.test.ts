import type { EntityManager } from '@mikro-orm/postgresql'
import { ApiKey } from '../../data/entities'
import { DefaultApiKeyPrincipalService } from '../principalService'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

describe('DefaultApiKeyPrincipalService session role revocation', () => {
  const manager = { name: 'principal-entity-manager' } as unknown as EntityManager
  const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
  let key: ApiKey
  let currentRoleIds: string[]

  beforeEach(() => {
    jest.clearAllMocks()
    key = Object.assign(new ApiKey(), {
      id: 'key-1', tenantId: 'tenant-1', organizationId: 'org-1',
      sessionUserId: 'user-1', sessionToken: 'sess_principal',
      rolesJson: ['role-reader', 'role-privileged'], expiresAt: null, deletedAt: null,
    })
    currentRoleIds = ['role-reader', 'role-privileged']
    mockFindOneWithDecryption.mockImplementation(async (
      _manager: unknown,
      _entity: unknown,
      _where: unknown,
      options: { fields: Array<keyof ApiKey> },
    ) => Object.fromEntries(options.fields.map((field) => [field, key[field]])))
    mockFindWithDecryption.mockImplementation(async () => currentRoleIds.map((roleId) => ({ role: { id: roleId } })))
  })

  it('returns only issued roles still held when a session key resolves document-share principals', async () => {
    const service = new DefaultApiKeyPrincipalService(manager)
    await expect(service.resolveAssignedRoleIds(key.id, scope)).resolves.toEqual(['role-reader', 'role-privileged'])

    currentRoleIds = ['role-reader', 'role-new']

    await expect(service.resolveAssignedRoleIds(key.id, scope)).resolves.toEqual(['role-reader'])
    expect(key.rolesJson).toEqual(['role-reader', 'role-privileged'])
    expect(mockFindOneWithDecryption).toHaveBeenLastCalledWith(
      manager,
      ApiKey,
      expect.objectContaining({ id: key.id, tenantId: scope.tenantId, deletedAt: null }),
      { fields: expect.arrayContaining([
        'rolesJson', 'expiresAt', 'tenantId', 'sessionUserId', 'sessionToken', 'sessionSecretEncrypted', 'opencodeSessionId',
      ]) },
      scope,
    )
    expect(mockFindWithDecryption).toHaveBeenLastCalledWith(
      manager,
      expect.any(Function),
      expect.objectContaining({
        user: { id: 'user-1', tenantId: scope.tenantId, deletedAt: null },
        role: { id: { $in: key.rolesJson }, tenantId: scope.tenantId, deletedAt: null },
        deletedAt: null,
      }),
      { populate: ['role'] },
      { tenantId: scope.tenantId, organizationId: null },
    )
  })

  it('preserves independent-key assignments and normalization without requiring user memberships', async () => {
    key.sessionUserId = null
    key.sessionToken = null
    key.rolesJson = [' role-reader ', 'role-reader', 'role-privileged']
    currentRoleIds = []

    await expect(new DefaultApiKeyPrincipalService(manager).resolveAssignedRoleIds(key.id, scope))
      .resolves.toEqual(['role-reader', 'role-privileged'])
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('returns no roles for an expired session key', async () => {
    key.expiresAt = new Date(Date.now() - 1)

    await expect(new DefaultApiKeyPrincipalService(manager).resolveAssignedRoleIds(key.id, scope)).resolves.toEqual([])
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })
})
