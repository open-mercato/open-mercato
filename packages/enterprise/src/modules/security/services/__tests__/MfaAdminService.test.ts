import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitSecurityEvent } from '../../events'
import { MfaAdminService, MfaAdminServiceError } from '../MfaAdminService'

jest.mock('../../events', () => ({
  emitSecurityEvent: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(async (em: any, _entity: unknown, where: any) => {
    return em.findOne(_entity, where)
  }),
}))

type MockMethod = {
  id: string
  userId: string
  type: string
  label?: string | null
  isActive: boolean
  lastUsedAt?: Date | null
  updatedAt: Date
  deletedAt: Date | null
  createdAt: Date
}

type MockRecoveryCode = {
  userId: string
  isUsed: boolean
  usedAt?: Date | null
}

type MockUser = {
  id: string
  tenantId: string | null
  organizationId: string | null
  email: string
  deletedAt: Date | null
}

function createContext() {
  const methods: MockMethod[] = []
  const recoveryCodes: MockRecoveryCode[] = []
  const users = new Map<string, MockUser>([
    [
      'user-1',
      {
        id: 'user-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        email: 'user@example.com',
        deletedAt: null,
      },
    ],
  ])

  const em = {
    find: jest.fn(async (_entity: unknown, query: Record<string, unknown>) => {
      if ('isActive' in query) {
        const userIdQuery = query.userId
        const userIds =
          typeof userIdQuery === 'string'
            ? [userIdQuery]
            : (
                userIdQuery as { $in?: string[] } | undefined
              )?.$in ?? []
        return methods.filter(
          (item) =>
            userIds.includes(item.userId) &&
            item.isActive === query.isActive &&
            item.deletedAt === (query.deletedAt as Date | null),
        )
      }
      return recoveryCodes.filter(
        (item) => item.userId === query.userId && item.isUsed === query.isUsed,
      )
    }),
    findOne: jest.fn(async (_entity: unknown, query: Record<string, unknown>) => {
      if (typeof query.id !== 'string') return null
      const candidate = users.get(query.id)
      if (!candidate) return null
      if (query.deletedAt !== null) return null
      if (typeof query.tenantId === 'string' && candidate.tenantId !== query.tenantId) {
        return null
      }
      return candidate
    }),
    count: jest.fn(async (_entity: unknown, query: Record<string, unknown>) => {
      if ('isActive' in query) {
        return methods.filter(
          (item) =>
            item.userId === query.userId &&
            item.isActive === query.isActive &&
            item.deletedAt === (query.deletedAt as Date | null),
        ).length
      }
      return recoveryCodes.filter(
        (item) => item.userId === query.userId && item.isUsed === query.isUsed,
      ).length
    }),
    flush: jest.fn().mockResolvedValue(undefined),
  }

  const mfaEnforcementService = {
    checkUserCompliance: jest.fn(async () => ({ compliant: true, enforced: false as const })),
  }

  const service = new MfaAdminService(
    em as unknown as EntityManager,
    mfaEnforcementService as never,
  )

  return { service, em, users, methods, recoveryCodes, mfaEnforcementService }
}

const mockedFindWithDecryption = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>
const mockedFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockedEmitSecurityEvent = emitSecurityEvent as jest.MockedFunction<typeof emitSecurityEvent>

describe('MfaAdminService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  function seedTwoMethodsAndCodes(methods: MockMethod[], recoveryCodes: MockRecoveryCode[]) {
    methods.push(
      {
        id: 'method-1',
        userId: 'user-1',
        type: 'totp',
        label: 'Phone',
        isActive: true,
        lastUsedAt: null,
        updatedAt: new Date(),
        deletedAt: null,
        createdAt: new Date(),
      },
      {
        id: 'method-2',
        userId: 'user-1',
        type: 'passkey',
        label: 'YubiKey',
        isActive: true,
        lastUsedAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        createdAt: new Date(),
      },
    )
    recoveryCodes.push(
      { userId: 'user-1', isUsed: false, usedAt: null },
      { userId: 'user-1', isUsed: false, usedAt: null },
    )
  }

  test('resetUserMfa soft-deletes methods, invalidates recovery codes, and emits event (same-tenant non-superadmin)', async () => {
    const { service, methods, recoveryCodes } = createContext()
    seedTwoMethodsAndCodes(methods, recoveryCodes)

    await service.resetUserMfa('admin-1', 'user-1', 'security incident', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      isSuperAdmin: false,
    })

    expect(methods.every((method) => method.isActive === false)).toBe(true)
    expect(methods.every((method) => method.deletedAt instanceof Date)).toBe(true)
    expect(recoveryCodes.every((code) => code.isUsed === true)).toBe(true)
    expect(mockedEmitSecurityEvent).toHaveBeenCalledWith(
      'security.mfa.reset',
      expect.objectContaining({
        adminId: 'admin-1',
        targetUserId: 'user-1',
        reason: 'security incident',
      }),
    )
  })

  test('resetUserMfa rejects cross-tenant non-superadmin with 404 and performs no mutations or events', async () => {
    const { service, methods, recoveryCodes } = createContext()
    seedTwoMethodsAndCodes(methods, recoveryCodes)

    await expect(
      service.resetUserMfa('admin-2', 'user-1', 'investigation', {
        tenantId: 'tenant-2',
        organizationId: 'org-2',
        isSuperAdmin: false,
      }),
    ).rejects.toMatchObject({
      name: 'MfaAdminServiceError',
      statusCode: 404,
      message: 'User not found',
    } satisfies Partial<MfaAdminServiceError>)

    expect(methods.every((method) => method.isActive === true)).toBe(true)
    expect(methods.every((method) => method.deletedAt === null)).toBe(true)
    expect(recoveryCodes.every((code) => code.isUsed === false)).toBe(true)
    expect(mockedEmitSecurityEvent).not.toHaveBeenCalled()
  })

  test('resetUserMfa allows a superadmin in any tenant to reset MFA', async () => {
    const { service, methods, recoveryCodes } = createContext()
    seedTwoMethodsAndCodes(methods, recoveryCodes)

    await service.resetUserMfa('root-1', 'user-1', 'incident', {
      tenantId: 'tenant-2',
      organizationId: null,
      isSuperAdmin: true,
    })

    expect(methods.every((method) => method.isActive === false)).toBe(true)
    expect(methods.every((method) => method.deletedAt instanceof Date)).toBe(true)
    expect(recoveryCodes.every((code) => code.isUsed === true)).toBe(true)
    expect(mockedEmitSecurityEvent).toHaveBeenCalledWith(
      'security.mfa.reset',
      expect.objectContaining({ adminId: 'root-1', targetUserId: 'user-1' }),
    )
  })

  test('resetUserMfa rejects cross-organization non-superadmin within the same tenant', async () => {
    const { service, methods, recoveryCodes } = createContext()
    seedTwoMethodsAndCodes(methods, recoveryCodes)

    await expect(
      service.resetUserMfa('admin-3', 'user-1', 'investigation', {
        tenantId: 'tenant-1',
        organizationId: 'org-2',
        isSuperAdmin: false,
      }),
    ).rejects.toMatchObject({
      name: 'MfaAdminServiceError',
      statusCode: 404,
    } satisfies Partial<MfaAdminServiceError>)

    expect(methods.every((method) => method.isActive === true)).toBe(true)
    expect(recoveryCodes.every((code) => code.isUsed === false)).toBe(true)
    expect(mockedEmitSecurityEvent).not.toHaveBeenCalled()
  })

  test('resetUserMfa deprecated no-scope call is treated as non-superadmin and rejects with 404', async () => {
    const { service, methods, recoveryCodes } = createContext()
    seedTwoMethodsAndCodes(methods, recoveryCodes)

    await expect(
      service.resetUserMfa('admin-1', 'user-1', 'security incident'),
    ).rejects.toMatchObject({
      name: 'MfaAdminServiceError',
      statusCode: 404,
      message: 'User not found',
    } satisfies Partial<MfaAdminServiceError>)

    expect(methods.every((method) => method.isActive === true)).toBe(true)
    expect(recoveryCodes.every((code) => code.isUsed === false)).toBe(true)
    expect(mockedEmitSecurityEvent).not.toHaveBeenCalled()
  })

  test('getUserMfaStatus returns status summary including compliance', async () => {
    const { service, methods, recoveryCodes, mfaEnforcementService } = createContext()
    methods.push({
      id: 'method-1',
      userId: 'user-1',
      type: 'totp',
      label: 'Phone',
      isActive: true,
      lastUsedAt: new Date('2026-03-01T10:00:00.000Z'),
      updatedAt: new Date(),
      deletedAt: null,
      createdAt: new Date(),
    })
    recoveryCodes.push(
      { userId: 'user-1', isUsed: false, usedAt: null },
      { userId: 'user-1', isUsed: false, usedAt: null },
    )
    mfaEnforcementService.checkUserCompliance.mockResolvedValueOnce({
      compliant: false,
      enforced: true,
      deadline: new Date('2026-03-20T00:00:00.000Z'),
    })

    const status = await service.getUserMfaStatus('user-1')

    expect(status.enrolled).toBe(true)
    expect(status.recoveryCodesRemaining).toBe(2)
    expect(status.compliant).toBe(false)
    expect(status.methods).toHaveLength(1)
    expect(status.methods[0].type).toBe('totp')
    expect(status.methods[0].label).toBe('Phone')
  })

  test('bulkComplianceCheck returns compliance data for all tenant users (same-tenant non-superadmin)', async () => {
    const { service, methods, users, mfaEnforcementService } = createContext()
    users.set('user-2', {
      id: 'user-2',
      tenantId: 'tenant-1',
      organizationId: 'org-2',
      email: 'two@example.com',
      deletedAt: null,
    })
    mockedFindWithDecryption.mockResolvedValue([
      {
        id: 'user-1',
        email: 'one@example.com',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        lastLoginAt: new Date('2026-03-08T09:15:00.000Z'),
      },
      {
        id: 'user-2',
        email: 'two@example.com',
        tenantId: 'tenant-1',
        organizationId: 'org-2',
      },
    ] as never)
    methods.push({
      id: 'method-1',
      userId: 'user-1',
      type: 'totp',
      label: null,
      isActive: true,
      lastUsedAt: null,
      updatedAt: new Date(),
      deletedAt: null,
      createdAt: new Date(),
    })
    mfaEnforcementService.checkUserCompliance.mockResolvedValueOnce({ compliant: true, enforced: true })
    mfaEnforcementService.checkUserCompliance.mockResolvedValueOnce({ compliant: false, enforced: true })

    const result = await service.bulkComplianceCheck('tenant-1', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      isSuperAdmin: false,
    })

    expect(mockedFindWithDecryption).toHaveBeenCalledTimes(1)
    expect(mockedFindWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ tenantId: 'tenant-1', deletedAt: null }),
      expect.anything(),
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: null }),
    )
    expect(result).toEqual([
      {
        userId: 'user-1',
        email: 'one@example.com',
        enrolled: true,
        methodCount: 1,
        compliant: true,
        lastLoginAt: new Date('2026-03-08T09:15:00.000Z'),
      },
      {
        userId: 'user-2',
        email: 'two@example.com',
        enrolled: false,
        methodCount: 0,
        compliant: false,
      },
    ])
  })

  test('bulkComplianceCheck rejects cross-tenant non-superadmin with 404 and never decrypts', async () => {
    const { service, mfaEnforcementService } = createContext()

    await expect(
      service.bulkComplianceCheck('tenant-2', {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        isSuperAdmin: false,
      }),
    ).rejects.toMatchObject({
      name: 'MfaAdminServiceError',
      statusCode: 404,
      message: 'Tenant not found',
    } satisfies Partial<MfaAdminServiceError>)

    expect(mockedFindWithDecryption).not.toHaveBeenCalled()
    expect(mfaEnforcementService.checkUserCompliance).not.toHaveBeenCalled()
  })

  test('bulkComplianceCheck allows a superadmin to query any tenant', async () => {
    const { service, mfaEnforcementService } = createContext()
    mockedFindWithDecryption.mockResolvedValue([
      {
        id: 'user-x',
        email: 'x@example.com',
        tenantId: 'tenant-other',
        organizationId: null,
      },
    ] as never)
    mfaEnforcementService.checkUserCompliance.mockResolvedValueOnce({ compliant: true, enforced: false })

    const result = await service.bulkComplianceCheck('tenant-other', {
      tenantId: 'tenant-root',
      organizationId: null,
      isSuperAdmin: true,
    })

    expect(mockedFindWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ tenantId: 'tenant-other', deletedAt: null }),
      expect.anything(),
      expect.objectContaining({ tenantId: 'tenant-other', organizationId: null }),
    )
    expect(result).toHaveLength(1)
    expect(result[0].userId).toBe('user-x')
    expect(result[0].email).toBe('x@example.com')
  })

  test('bulkComplianceCheck deprecated no-scope call is treated as non-superadmin and rejects with 404', async () => {
    const { service, mfaEnforcementService } = createContext()

    await expect(service.bulkComplianceCheck('tenant-1')).rejects.toMatchObject({
      name: 'MfaAdminServiceError',
      statusCode: 404,
      message: 'Tenant not found',
    } satisfies Partial<MfaAdminServiceError>)

    expect(mockedFindWithDecryption).not.toHaveBeenCalled()
    expect(mfaEnforcementService.checkUserCompliance).not.toHaveBeenCalled()
  })

  test('bulkComplianceCheck rejects scope without tenantId for non-superadmin with 404', async () => {
    const { service, mfaEnforcementService } = createContext()

    await expect(
      service.bulkComplianceCheck('tenant-1', {
        tenantId: null,
        organizationId: null,
        isSuperAdmin: false,
      }),
    ).rejects.toMatchObject({
      name: 'MfaAdminServiceError',
      statusCode: 404,
      message: 'Tenant not found',
    } satisfies Partial<MfaAdminServiceError>)

    expect(mockedFindWithDecryption).not.toHaveBeenCalled()
    expect(mfaEnforcementService.checkUserCompliance).not.toHaveBeenCalled()
  })

  test('resetUserMfa requires a non-empty reason', async () => {
    const { service } = createContext()
    await expect(service.resetUserMfa('admin-1', 'user-1', '   ')).rejects.toMatchObject({
      name: 'MfaAdminServiceError',
      statusCode: 400,
      message: 'Reset reason is required',
    } satisfies Partial<MfaAdminServiceError>)
  })

  test('bulkComplianceCheck requires tenantId', async () => {
    const { service } = createContext()
    await expect(service.bulkComplianceCheck('')).rejects.toMatchObject({
      name: 'MfaAdminServiceError',
      statusCode: 400,
      message: 'Tenant ID is required',
    } satisfies Partial<MfaAdminServiceError>)
  })

  test('getUserMfaStatus rejects a foreign-tenant target for a non-superadmin actor with 404', async () => {
    const { service } = createContext()
    await expect(
      service.getUserMfaStatus('user-1', { tenantId: 'tenant-2', isSuperAdmin: false }),
    ).rejects.toMatchObject({
      name: 'MfaAdminServiceError',
      statusCode: 404,
      message: 'User not found',
    } satisfies Partial<MfaAdminServiceError>)
  })

  test('getUserMfaStatus allows a same-tenant target for a non-superadmin actor', async () => {
    const { service } = createContext()
    const status = await service.getUserMfaStatus('user-1', { tenantId: 'tenant-1', isSuperAdmin: false })
    expect(status.enrolled).toBe(false)
  })

  test('getUserMfaStatus allows a superadmin actor regardless of tenant', async () => {
    const { service } = createContext()
    const status = await service.getUserMfaStatus('user-1', { tenantId: 'tenant-2', isSuperAdmin: true })
    expect(status.enrolled).toBe(false)
  })

  test('resetUserMfa rejects a foreign-tenant target for a non-superadmin actor with 404', async () => {
    const { service } = createContext()
    await expect(
      service.resetUserMfa('admin-1', 'user-1', 'security incident', { tenantId: 'tenant-2', isSuperAdmin: false }),
    ).rejects.toMatchObject({
      name: 'MfaAdminServiceError',
      statusCode: 404,
      message: 'User not found',
    } satisfies Partial<MfaAdminServiceError>)
  })

})
