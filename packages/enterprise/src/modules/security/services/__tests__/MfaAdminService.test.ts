import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitSecurityEvent } from '../../events'
import { MfaAdminService, MfaAdminServiceError } from '../MfaAdminService'

jest.mock('../../events', () => ({
  emitSecurityEvent: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
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

function createContext() {
  const methods: MockMethod[] = []
  const recoveryCodes: MockRecoveryCode[] = []
  const users = new Set<string>(['user-1'])

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
      if (typeof query.id === 'string' && users.has(query.id) && query.deletedAt === null) {
        return {
          id: query.id,
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          email: 'user@example.com',
          deletedAt: null,
        }
      }
      return null
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
const mockedEmitSecurityEvent = emitSecurityEvent as jest.MockedFunction<typeof emitSecurityEvent>

describe('MfaAdminService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('resetUserMfa soft-deletes methods, invalidates recovery codes, and emits event', async () => {
    const { service, methods, recoveryCodes } = createContext()
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

    await service.resetUserMfa('admin-1', 'user-1', 'security incident')

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

  test('bulkComplianceCheck returns compliance data for all tenant users', async () => {
    const { service, methods, users, mfaEnforcementService } = createContext()
    users.add('user-2')
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

    const result = await service.bulkComplianceCheck('tenant-1')

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
})
