import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  EnforcementScope,
  MfaEnforcementPolicy,
  UserMfaMethod,
} from '../../data/entities'
import { emitSecurityEvent } from '../../events'
import { MfaEnforcementService, MfaEnforcementServiceError } from '../MfaEnforcementService'

jest.mock('../../events', () => ({
  emitSecurityEvent: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

type PolicyRow = {
  id: string
  scope: EnforcementScope
  tenantId: string | null
  organizationId: string | null
  isEnforced: boolean
  allowedMethods: string[] | null
  enforcementDeadline: Date | null
  enforcedBy: string
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

type UserRow = {
  id: string
  tenantId: string | null
  organizationId: string | null
  deletedAt: Date | null
}

type MethodRow = {
  id: string
  userId: string
  type: string
  isActive: boolean
  deletedAt: Date | null
}

function createContext() {
  const policies: PolicyRow[] = []
  const users: UserRow[] = []
  const methods: MethodRow[] = []

  const em = {
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      if (entity === MfaEnforcementPolicy) {
        return {
          id: `policy-${policies.length + 1}`,
          scope: data.scope as EnforcementScope,
          tenantId: (data.tenantId as string | null | undefined) ?? null,
          organizationId: (data.organizationId as string | null | undefined) ?? null,
          isEnforced: Boolean(data.isEnforced),
          allowedMethods: (data.allowedMethods as string[] | null | undefined) ?? null,
          enforcementDeadline: (data.enforcementDeadline as Date | null | undefined) ?? null,
          enforcedBy: String(data.enforcedBy),
          createdAt: data.createdAt as Date,
          updatedAt: data.updatedAt as Date,
          deletedAt: null,
        }
      }
      throw new Error('Unexpected create entity')
    }),
    persist: jest.fn((row: PolicyRow) => {
      policies.push(row)
    }),
    flush: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn(async (entity: unknown, query: Record<string, unknown>) => {
      if (entity !== MfaEnforcementPolicy) return null
      if ('id' in query) {
        return (
          policies.find(
            (item) => item.id === query.id && item.deletedAt === (query.deletedAt as Date | null),
          ) ?? null
        )
      }
      return (
        policies.find((item) => {
          if (item.scope !== query.scope) return false
          if (item.tenantId !== ((query.tenantId as string | null | undefined) ?? null)) return false
          if (item.organizationId !== ((query.organizationId as string | null | undefined) ?? null)) return false
          if (item.deletedAt !== ((query.deletedAt as Date | null | undefined) ?? null)) return false
          return true
        }) ?? null
      )
    }),
    find: jest.fn(async (entity: unknown, query: Record<string, unknown>) => {
      if (entity === User) {
        return users.filter((row) => {
          if (row.deletedAt !== ((query.deletedAt as Date | null | undefined) ?? null)) return false
          if (query.tenantId !== undefined && row.tenantId !== query.tenantId) return false
          if (query.organizationId !== undefined && row.organizationId !== query.organizationId) return false
          return true
        })
      }

      if (entity === UserMfaMethod) {
        return methods.filter((row) => {
          if (row.isActive !== query.isActive) return false
          if (row.deletedAt !== ((query.deletedAt as Date | null | undefined) ?? null)) return false

          if (typeof query.userId === 'string' && row.userId !== query.userId) return false
          if (typeof query.userId === 'object' && query.userId !== null) {
            const idFilter = query.userId as { $in?: string[] }
            if (idFilter.$in && !idFilter.$in.includes(row.userId)) return false
          }

          if (query.type) {
            const typeFilter = query.type as { $in?: string[] }
            if (typeFilter.$in && !typeFilter.$in.includes(row.type)) return false
          }
          return true
        })
      }

      return []
    }),
    count: jest.fn(async (entity: unknown, query: Record<string, unknown>) => {
      if (entity !== UserMfaMethod) return 0
      return methods.filter((row) => {
        if (row.userId !== query.userId) return false
        if (row.isActive !== query.isActive) return false
        if (row.deletedAt !== ((query.deletedAt as Date | null | undefined) ?? null)) return false
        if (query.type) {
          const typeFilter = query.type as { $in?: string[] }
          if (typeFilter.$in && !typeFilter.$in.includes(row.type)) return false
        }
        return true
      }).length
    }),
  }

  const service = new MfaEnforcementService(em as unknown as EntityManager)
  return { service, em, policies, users, methods }
}

const mockedFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockedEmitSecurityEvent = emitSecurityEvent as jest.MockedFunction<typeof emitSecurityEvent>

describe('MfaEnforcementService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('isEnforced uses organisation policy before tenant and platform', async () => {
    const { service, policies } = createContext()
    policies.push(
      {
        id: 'platform',
        scope: EnforcementScope.PLATFORM,
        tenantId: null,
        organizationId: null,
        isEnforced: true,
        allowedMethods: null,
        enforcementDeadline: null,
        enforcedBy: 'admin-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
      {
        id: 'tenant',
        scope: EnforcementScope.TENANT,
        tenantId: 'tenant-1',
        organizationId: null,
        isEnforced: true,
        allowedMethods: null,
        enforcementDeadline: null,
        enforcedBy: 'admin-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
      {
        id: 'org',
        scope: EnforcementScope.ORGANISATION,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        isEnforced: false,
        allowedMethods: null,
        enforcementDeadline: null,
        enforcedBy: 'admin-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    )

    const result = await service.isEnforced('tenant-1', 'org-1')

    expect(result.enforced).toBe(false)
    expect(result.policy?.id).toBe('org')
  })

  test('createPolicy creates new row and emits created event (same-tenant non-superadmin)', async () => {
    const { service, policies } = createContext()

    const policy = await service.createPolicy(
      {
        scope: EnforcementScope.TENANT,
        tenantId: '00000000-0000-4000-8000-000000000001',
        isEnforced: true,
        allowedMethods: ['totp', 'passkey'],
      },
      'admin-1',
      {
        tenantId: '00000000-0000-4000-8000-000000000001',
        organizationId: null,
        isSuperAdmin: false,
      },
    )

    expect(policy.id).toBe('policy-1')
    expect(policies).toHaveLength(1)
    expect(policies[0].scope).toBe(EnforcementScope.TENANT)
    expect(mockedEmitSecurityEvent).toHaveBeenCalledWith(
      'security.enforcement.created',
      expect.objectContaining({ adminId: 'admin-1', policyId: 'policy-1' }),
    )
  })

  test('createPolicy updates existing scope policy and emits updated event (same-tenant non-superadmin)', async () => {
    const { service, policies } = createContext()
    policies.push({
      id: 'policy-1',
      scope: EnforcementScope.TENANT,
      tenantId: 'tenant-1',
      organizationId: null,
      isEnforced: true,
      allowedMethods: ['totp'],
      enforcementDeadline: null,
      enforcedBy: 'admin-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    })

    const result = await service.createPolicy(
      {
        scope: EnforcementScope.TENANT,
        tenantId: 'tenant-1',
        isEnforced: false,
        allowedMethods: ['passkey'],
      },
      'admin-2',
      { tenantId: 'tenant-1', organizationId: null, isSuperAdmin: false },
    )

    expect(result.id).toBe('policy-1')
    expect(result.isEnforced).toBe(false)
    expect(result.allowedMethods).toEqual(['passkey'])
    expect(mockedEmitSecurityEvent).toHaveBeenCalledWith(
      'security.enforcement.updated',
      expect.objectContaining({ adminId: 'admin-2', policyId: 'policy-1' }),
    )
  })

  test('createPolicy allows non-superadmin ORGANISATION scope when organizationId matches', async () => {
    const { service, policies } = createContext()

    const policy = await service.createPolicy(
      {
        scope: EnforcementScope.ORGANISATION,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        isEnforced: true,
      },
      'admin-1',
      { tenantId: 'tenant-1', organizationId: 'org-1', isSuperAdmin: false },
    )

    expect(policy.id).toBe('policy-1')
    expect(policies).toHaveLength(1)
    expect(policies[0].scope).toBe(EnforcementScope.ORGANISATION)
    expect(policies[0].organizationId).toBe('org-1')
  })

  test('createPolicy rejects non-superadmin PLATFORM attempt with 403 and persists nothing', async () => {
    const { service, policies, em } = createContext()

    await expect(
      service.createPolicy(
        { scope: EnforcementScope.PLATFORM, isEnforced: false },
        'admin-1',
        { tenantId: 'tenant-1', organizationId: null, isSuperAdmin: false },
      ),
    ).rejects.toMatchObject({
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
      message: 'Insufficient scope for enforcement policy',
    } satisfies Partial<MfaEnforcementServiceError>)

    expect(policies).toHaveLength(0)
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(mockedEmitSecurityEvent).not.toHaveBeenCalled()
  })

  test('createPolicy rejects non-superadmin cross-tenant TENANT scope with 403 and persists nothing', async () => {
    const { service, policies, em } = createContext()

    await expect(
      service.createPolicy(
        {
          scope: EnforcementScope.TENANT,
          tenantId: 'tenant-2',
          isEnforced: true,
        },
        'admin-1',
        { tenantId: 'tenant-1', organizationId: null, isSuperAdmin: false },
      ),
    ).rejects.toMatchObject({
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
      message: 'Insufficient scope for enforcement policy',
    } satisfies Partial<MfaEnforcementServiceError>)

    expect(policies).toHaveLength(0)
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(mockedEmitSecurityEvent).not.toHaveBeenCalled()
  })

  test('createPolicy rejects non-superadmin ORGANISATION with mismatched organizationId with 403', async () => {
    const { service, policies, em } = createContext()

    await expect(
      service.createPolicy(
        {
          scope: EnforcementScope.ORGANISATION,
          tenantId: 'tenant-1',
          organizationId: 'org-2',
          isEnforced: true,
        },
        'admin-1',
        { tenantId: 'tenant-1', organizationId: 'org-1', isSuperAdmin: false },
      ),
    ).rejects.toMatchObject({
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
      message: 'Insufficient scope for enforcement policy',
    } satisfies Partial<MfaEnforcementServiceError>)

    expect(policies).toHaveLength(0)
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(mockedEmitSecurityEvent).not.toHaveBeenCalled()
  })

  test('createPolicy rejects non-superadmin scope without tenantId with 403', async () => {
    const { service, policies, em } = createContext()

    await expect(
      service.createPolicy(
        {
          scope: EnforcementScope.TENANT,
          tenantId: 'tenant-1',
          isEnforced: true,
        },
        'admin-1',
        { tenantId: null, organizationId: null, isSuperAdmin: false },
      ),
    ).rejects.toMatchObject({
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
      message: 'Insufficient scope for enforcement policy',
    } satisfies Partial<MfaEnforcementServiceError>)

    expect(policies).toHaveLength(0)
    expect(em.persist).not.toHaveBeenCalled()
    expect(mockedEmitSecurityEvent).not.toHaveBeenCalled()
  })

  test('createPolicy allows superadmin to create PLATFORM scope', async () => {
    const { service, policies } = createContext()

    const policy = await service.createPolicy(
      { scope: EnforcementScope.PLATFORM, isEnforced: false },
      'root-1',
      { tenantId: null, organizationId: null, isSuperAdmin: true },
    )

    expect(policy.id).toBe('policy-1')
    expect(policies).toHaveLength(1)
    expect(policies[0].scope).toBe(EnforcementScope.PLATFORM)
    expect(mockedEmitSecurityEvent).toHaveBeenCalledWith(
      'security.enforcement.created',
      expect.objectContaining({ adminId: 'root-1', policyId: 'policy-1' }),
    )
  })

  test('createPolicy allows superadmin to create policy for any tenant', async () => {
    const { service, policies } = createContext()

    const policy = await service.createPolicy(
      {
        scope: EnforcementScope.TENANT,
        tenantId: 'tenant-2',
        isEnforced: true,
      },
      'root-1',
      { tenantId: 'tenant-root', organizationId: null, isSuperAdmin: true },
    )

    expect(policy.id).toBe('policy-1')
    expect(policies).toHaveLength(1)
    expect(policies[0].tenantId).toBe('tenant-2')
  })

  test('createPolicy deprecated no-scope overload rejects with 403 and persists nothing', async () => {
    const { service, policies, em } = createContext()

    await expect(
      service.createPolicy(
        {
          scope: EnforcementScope.TENANT,
          tenantId: 'tenant-1',
          isEnforced: true,
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
      message: 'Insufficient scope for enforcement policy',
    } satisfies Partial<MfaEnforcementServiceError>)

    expect(policies).toHaveLength(0)
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(mockedEmitSecurityEvent).not.toHaveBeenCalled()
  })

  function seedTenantPolicy(
    policies: PolicyRow[],
    overrides: Partial<PolicyRow> = {},
  ): PolicyRow {
    const row: PolicyRow = {
      id: 'policy-1',
      scope: EnforcementScope.TENANT,
      tenantId: 'tenant-1',
      organizationId: null,
      isEnforced: true,
      allowedMethods: ['totp'],
      enforcementDeadline: null,
      enforcedBy: 'admin-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    }
    policies.push(row)
    return row
  }

  function snapshotPolicy(row: PolicyRow): Omit<PolicyRow, 'createdAt' | 'updatedAt'> {
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = row
    return { ...rest }
  }

  test('updatePolicy updates own-tenant TENANT policy and emits updated event (same-tenant non-superadmin)', async () => {
    const { service, policies } = createContext()
    const seeded = seedTenantPolicy(policies)

    const result = await service.updatePolicy(
      seeded.id,
      { isEnforced: false, allowedMethods: ['passkey'] },
      'admin-2',
      { tenantId: 'tenant-1', organizationId: null, isSuperAdmin: false },
    )

    expect(result.id).toBe(seeded.id)
    expect(result.isEnforced).toBe(false)
    expect(result.allowedMethods).toEqual(['passkey'])
    expect(mockedEmitSecurityEvent).toHaveBeenCalledWith(
      'security.enforcement.updated',
      expect.objectContaining({ adminId: 'admin-2', policyId: seeded.id }),
    )
  })

  test('updatePolicy rejects non-superadmin updating cross-tenant policy with 403 and persists nothing', async () => {
    const { service, policies, em } = createContext()
    const seeded = seedTenantPolicy(policies, { tenantId: 'tenant-2' })
    const before = snapshotPolicy(seeded)

    await expect(
      service.updatePolicy(
        seeded.id,
        { isEnforced: false },
        'admin-1',
        { tenantId: 'tenant-1', organizationId: null, isSuperAdmin: false },
      ),
    ).rejects.toMatchObject({
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
      message: 'Insufficient scope for enforcement policy',
    } satisfies Partial<MfaEnforcementServiceError>)

    expect(em.flush).not.toHaveBeenCalled()
    expect(mockedEmitSecurityEvent).not.toHaveBeenCalled()
    expect(snapshotPolicy(policies[0])).toEqual(before)
  })

  test('updatePolicy rejects non-superadmin escalation to PLATFORM with 403 and persists nothing', async () => {
    const { service, policies, em } = createContext()
    const seeded = seedTenantPolicy(policies)
    const before = snapshotPolicy(seeded)

    await expect(
      service.updatePolicy(
        seeded.id,
        { scope: EnforcementScope.PLATFORM },
        'admin-1',
        { tenantId: 'tenant-1', organizationId: null, isSuperAdmin: false },
      ),
    ).rejects.toMatchObject({
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
      message: 'Insufficient scope for enforcement policy',
    } satisfies Partial<MfaEnforcementServiceError>)

    expect(em.flush).not.toHaveBeenCalled()
    expect(mockedEmitSecurityEvent).not.toHaveBeenCalled()
    expect(snapshotPolicy(policies[0])).toEqual(before)
  })

  test('updatePolicy rejects non-superadmin reassigning tenantId with 403', async () => {
    const { service, policies, em } = createContext()
    const seeded = seedTenantPolicy(policies)
    const before = snapshotPolicy(seeded)

    await expect(
      service.updatePolicy(
        seeded.id,
        { tenantId: 'tenant-2' },
        'admin-1',
        { tenantId: 'tenant-1', organizationId: null, isSuperAdmin: false },
      ),
    ).rejects.toMatchObject({
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
      message: 'Insufficient scope for enforcement policy',
    } satisfies Partial<MfaEnforcementServiceError>)

    expect(em.flush).not.toHaveBeenCalled()
    expect(mockedEmitSecurityEvent).not.toHaveBeenCalled()
    expect(snapshotPolicy(policies[0])).toEqual(before)
  })

  test('updatePolicy rejects non-superadmin updating ORGANISATION policy for different org with 403', async () => {
    const { service, policies, em } = createContext()
    const seeded = seedTenantPolicy(policies, {
      scope: EnforcementScope.ORGANISATION,
      organizationId: 'org-2',
    })
    const before = snapshotPolicy(seeded)

    await expect(
      service.updatePolicy(
        seeded.id,
        { isEnforced: false },
        'admin-1',
        { tenantId: 'tenant-1', organizationId: 'org-1', isSuperAdmin: false },
      ),
    ).rejects.toMatchObject({
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
      message: 'Insufficient scope for enforcement policy',
    } satisfies Partial<MfaEnforcementServiceError>)

    expect(em.flush).not.toHaveBeenCalled()
    expect(snapshotPolicy(policies[0])).toEqual(before)
  })

  test('updatePolicy rejects non-superadmin attempting to move ORGANISATION policy to a different org with 403', async () => {
    const { service, policies, em } = createContext()
    const seeded = seedTenantPolicy(policies, {
      scope: EnforcementScope.ORGANISATION,
      organizationId: 'org-1',
    })
    const before = snapshotPolicy(seeded)

    await expect(
      service.updatePolicy(
        seeded.id,
        { organizationId: 'org-2' },
        'admin-1',
        { tenantId: 'tenant-1', organizationId: 'org-1', isSuperAdmin: false },
      ),
    ).rejects.toMatchObject({
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
      message: 'Insufficient scope for enforcement policy',
    } satisfies Partial<MfaEnforcementServiceError>)

    expect(em.flush).not.toHaveBeenCalled()
    expect(snapshotPolicy(policies[0])).toEqual(before)
  })

  test('updatePolicy rejects non-superadmin updating PLATFORM-scoped policy with 403', async () => {
    const { service, policies, em } = createContext()
    const seeded = seedTenantPolicy(policies, {
      scope: EnforcementScope.PLATFORM,
      tenantId: null,
      organizationId: null,
    })
    const before = snapshotPolicy(seeded)

    await expect(
      service.updatePolicy(
        seeded.id,
        { isEnforced: false },
        'admin-1',
        { tenantId: 'tenant-1', organizationId: null, isSuperAdmin: false },
      ),
    ).rejects.toMatchObject({
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
      message: 'Insufficient scope for enforcement policy',
    } satisfies Partial<MfaEnforcementServiceError>)

    expect(em.flush).not.toHaveBeenCalled()
    expect(snapshotPolicy(policies[0])).toEqual(before)
  })

  test('updatePolicy allows superadmin to update any tenant policy', async () => {
    const { service, policies } = createContext()
    const seeded = seedTenantPolicy(policies, { tenantId: 'tenant-2' })

    const result = await service.updatePolicy(
      seeded.id,
      { isEnforced: false },
      'root-1',
      { tenantId: 'tenant-root', organizationId: null, isSuperAdmin: true },
    )

    expect(result.isEnforced).toBe(false)
    expect(mockedEmitSecurityEvent).toHaveBeenCalledWith(
      'security.enforcement.updated',
      expect.objectContaining({ adminId: 'root-1', policyId: seeded.id }),
    )
  })

  test('updatePolicy allows superadmin to promote TENANT to PLATFORM', async () => {
    const { service, policies } = createContext()
    const seeded = seedTenantPolicy(policies)

    const result = await service.updatePolicy(
      seeded.id,
      { scope: EnforcementScope.PLATFORM, tenantId: null },
      'root-1',
      { tenantId: null, organizationId: null, isSuperAdmin: true },
    )

    expect(result.scope).toBe(EnforcementScope.PLATFORM)
    expect(result.tenantId).toBeNull()
    expect(mockedEmitSecurityEvent).toHaveBeenCalledWith(
      'security.enforcement.updated',
      expect.objectContaining({ adminId: 'root-1', policyId: seeded.id }),
    )
  })

  test('updatePolicy deprecated no-scope overload rejects with 403 and persists nothing', async () => {
    const { service, policies, em } = createContext()
    const seeded = seedTenantPolicy(policies)
    const before = snapshotPolicy(seeded)

    await expect(
      service.updatePolicy(seeded.id, { isEnforced: false }, 'admin-1'),
    ).rejects.toMatchObject({
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
      message: 'Insufficient scope for enforcement policy',
    } satisfies Partial<MfaEnforcementServiceError>)

    expect(em.flush).not.toHaveBeenCalled()
    expect(mockedEmitSecurityEvent).not.toHaveBeenCalled()
    expect(snapshotPolicy(policies[0])).toEqual(before)
  })

  test('updatePolicy rejects non-superadmin scope without tenantId with 403', async () => {
    const { service, policies, em } = createContext()
    const seeded = seedTenantPolicy(policies)
    const before = snapshotPolicy(seeded)

    await expect(
      service.updatePolicy(
        seeded.id,
        { isEnforced: false },
        'admin-1',
        { tenantId: null, organizationId: null, isSuperAdmin: false },
      ),
    ).rejects.toMatchObject({
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
      message: 'Insufficient scope for enforcement policy',
    } satisfies Partial<MfaEnforcementServiceError>)

    expect(em.flush).not.toHaveBeenCalled()
    expect(snapshotPolicy(policies[0])).toEqual(before)
  })

  test('deletePolicy soft-deletes own-tenant TENANT policy (same-tenant non-superadmin)', async () => {
    const { service, policies, em } = createContext()
    const seeded = seedTenantPolicy(policies)

    await service.deletePolicy(seeded.id, {
      tenantId: 'tenant-1',
      organizationId: null,
      isSuperAdmin: false,
    })

    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(policies[0].deletedAt).toBeInstanceOf(Date)
    expect(mockedEmitSecurityEvent).not.toHaveBeenCalled()
  })

  test('deletePolicy rejects non-superadmin deleting cross-tenant policy with 403 and persists nothing', async () => {
    const { service, policies, em } = createContext()
    const seeded = seedTenantPolicy(policies, { tenantId: 'tenant-2' })
    const before = snapshotPolicy(seeded)

    await expect(
      service.deletePolicy(seeded.id, {
        tenantId: 'tenant-1',
        organizationId: null,
        isSuperAdmin: false,
      }),
    ).rejects.toMatchObject({
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
      message: 'Insufficient scope for enforcement policy',
    } satisfies Partial<MfaEnforcementServiceError>)

    expect(em.flush).not.toHaveBeenCalled()
    expect(mockedEmitSecurityEvent).not.toHaveBeenCalled()
    expect(snapshotPolicy(policies[0])).toEqual(before)
  })

  test('deletePolicy rejects non-superadmin deleting PLATFORM-scope policy with 403 and persists nothing', async () => {
    const { service, policies, em } = createContext()
    const seeded = seedTenantPolicy(policies, {
      scope: EnforcementScope.PLATFORM,
      tenantId: null,
      organizationId: null,
    })
    const before = snapshotPolicy(seeded)

    await expect(
      service.deletePolicy(seeded.id, {
        tenantId: 'tenant-1',
        organizationId: null,
        isSuperAdmin: false,
      }),
    ).rejects.toMatchObject({
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
      message: 'Insufficient scope for enforcement policy',
    } satisfies Partial<MfaEnforcementServiceError>)

    expect(em.flush).not.toHaveBeenCalled()
    expect(mockedEmitSecurityEvent).not.toHaveBeenCalled()
    expect(snapshotPolicy(policies[0])).toEqual(before)
  })

  test('deletePolicy rejects non-superadmin deleting ORGANISATION policy for different org with 403', async () => {
    const { service, policies, em } = createContext()
    const seeded = seedTenantPolicy(policies, {
      scope: EnforcementScope.ORGANISATION,
      tenantId: 'tenant-1',
      organizationId: 'org-2',
    })
    const before = snapshotPolicy(seeded)

    await expect(
      service.deletePolicy(seeded.id, {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        isSuperAdmin: false,
      }),
    ).rejects.toMatchObject({
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
      message: 'Insufficient scope for enforcement policy',
    } satisfies Partial<MfaEnforcementServiceError>)

    expect(em.flush).not.toHaveBeenCalled()
    expect(mockedEmitSecurityEvent).not.toHaveBeenCalled()
    expect(snapshotPolicy(policies[0])).toEqual(before)
  })

  test('deletePolicy allows superadmin to delete any tenant policy', async () => {
    const { service, policies, em } = createContext()
    const seeded = seedTenantPolicy(policies, { tenantId: 'tenant-2' })

    await service.deletePolicy(seeded.id, {
      tenantId: 'tenant-root',
      organizationId: null,
      isSuperAdmin: true,
    })

    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(policies[0].deletedAt).toBeInstanceOf(Date)
  })

  test('deletePolicy allows superadmin to delete PLATFORM policy', async () => {
    const { service, policies, em } = createContext()
    const seeded = seedTenantPolicy(policies, {
      scope: EnforcementScope.PLATFORM,
      tenantId: null,
      organizationId: null,
    })

    await service.deletePolicy(seeded.id, {
      tenantId: null,
      organizationId: null,
      isSuperAdmin: true,
    })

    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(policies[0].deletedAt).toBeInstanceOf(Date)
    expect(seeded.id).toBe(policies[0].id)
  })

  test('deletePolicy deprecated no-scope overload rejects with 403 and persists nothing', async () => {
    const { service, policies, em } = createContext()
    const seeded = seedTenantPolicy(policies)
    const before = snapshotPolicy(seeded)

    await expect(service.deletePolicy(seeded.id)).rejects.toMatchObject({
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
      message: 'Insufficient scope for enforcement policy',
    } satisfies Partial<MfaEnforcementServiceError>)

    expect(em.flush).not.toHaveBeenCalled()
    expect(mockedEmitSecurityEvent).not.toHaveBeenCalled()
    expect(snapshotPolicy(policies[0])).toEqual(before)
  })

  test('deletePolicy rejects non-superadmin scope without tenantId with 403', async () => {
    const { service, policies, em } = createContext()
    const seeded = seedTenantPolicy(policies)
    const before = snapshotPolicy(seeded)

    await expect(
      service.deletePolicy(seeded.id, {
        tenantId: null,
        organizationId: null,
        isSuperAdmin: false,
      }),
    ).rejects.toMatchObject({
      name: 'MfaEnforcementServiceError',
      statusCode: 403,
      message: 'Insufficient scope for enforcement policy',
    } satisfies Partial<MfaEnforcementServiceError>)

    expect(em.flush).not.toHaveBeenCalled()
    expect(snapshotPolicy(policies[0])).toEqual(before)
  })

  test('deletePolicy returns 404 when policy not found', async () => {
    const { service, em } = createContext()

    await expect(
      service.deletePolicy('missing-policy-id', {
        tenantId: 'tenant-1',
        organizationId: null,
        isSuperAdmin: false,
      }),
    ).rejects.toMatchObject({
      name: 'MfaEnforcementServiceError',
      statusCode: 404,
      message: 'Enforcement policy not found',
    } satisfies Partial<MfaEnforcementServiceError>)

    expect(em.flush).not.toHaveBeenCalled()
  })

  test('getComplianceReport returns overdue unenrolled users after deadline', async () => {
    const { service, policies, users, methods } = createContext()
    policies.push({
      id: 'policy-1',
      scope: EnforcementScope.TENANT,
      tenantId: 'tenant-1',
      organizationId: null,
      isEnforced: true,
      allowedMethods: ['totp'],
      enforcementDeadline: new Date(Date.now() - 60_000),
      enforcedBy: 'admin-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    })
    users.push(
      { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1', deletedAt: null },
      { id: 'user-2', tenantId: 'tenant-1', organizationId: 'org-1', deletedAt: null },
    )
    methods.push({
      id: 'method-1',
      userId: 'user-1',
      type: 'totp',
      isActive: true,
      deletedAt: null,
    })

    const report = await service.getComplianceReport(EnforcementScope.TENANT, 'tenant-1')

    expect(report).toEqual({
      total: 2,
      enrolled: 1,
      pending: 0,
      overdue: 1,
    })
  })

  test('getComplianceReport rejects platform scope for a non-superadmin without querying users', async () => {
    const { service, em } = createContext()

    await expect(
      service.getComplianceReport(EnforcementScope.PLATFORM, undefined, {
        tenantId: 'tenant-1',
        isSuperAdmin: false,
      }),
    ).rejects.toMatchObject({ statusCode: 403 })

    expect(em.find).not.toHaveBeenCalledWith(User, expect.anything())
  })

  test('getComplianceReport rejects a foreign tenant for a non-superadmin without querying users', async () => {
    const { service, em } = createContext()

    await expect(
      service.getComplianceReport(EnforcementScope.TENANT, 'tenant-2', {
        tenantId: 'tenant-1',
        isSuperAdmin: false,
      }),
    ).rejects.toMatchObject({ statusCode: 403 })

    expect(em.find).not.toHaveBeenCalledWith(User, expect.anything())
  })

  test('getComplianceReport allows a superadmin to query platform scope', async () => {
    const { service, users } = createContext()
    users.push({ id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1', deletedAt: null })

    const report = await service.getComplianceReport(EnforcementScope.PLATFORM, undefined, {
      tenantId: 'tenant-9',
      isSuperAdmin: true,
    })

    expect(report.total).toBe(1)
  })

  test('listPolicies constrains a non-superadmin to its own tenant', async () => {
    const { service, em } = createContext()

    await service.listPolicies(undefined, { tenantId: 'tenant-1', isSuperAdmin: false })

    expect(em.find).toHaveBeenCalledWith(
      MfaEnforcementPolicy,
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.anything(),
    )
  })

  test('listPolicies does not constrain a superadmin', async () => {
    const { service, em } = createContext()

    await service.listPolicies(undefined, { tenantId: 'tenant-1', isSuperAdmin: true })

    const call = em.find.mock.calls.find((entry) => entry[0] === MfaEnforcementPolicy)
    expect(call?.[1]).not.toHaveProperty('tenantId')
  })

  test('createPolicy rejects a foreign tenant scope for a non-superadmin', async () => {
    const { service, policies } = createContext()

    await expect(
      service.createPolicy(
        { scope: EnforcementScope.TENANT, tenantId: 'tenant-2', isEnforced: true },
        'admin-1',
        { tenantId: 'tenant-1', isSuperAdmin: false },
      ),
    ).rejects.toMatchObject({ statusCode: 403 })

    expect(policies).toHaveLength(0)
  })

  test('deletePolicy rejects when the actor does not own the policy scope', async () => {
    const { service, policies } = createContext()
    policies.push({
      id: 'policy-1',
      scope: EnforcementScope.TENANT,
      tenantId: 'tenant-2',
      organizationId: null,
      isEnforced: true,
      allowedMethods: null,
      enforcementDeadline: null,
      enforcedBy: 'admin-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    })

    await expect(
      service.deletePolicy('policy-1', { tenantId: 'tenant-1', isSuperAdmin: false }),
    ).rejects.toMatchObject({ statusCode: 403 })

    expect(policies[0].deletedAt).toBeNull()
  })

  test('checkUserCompliance enforces allowed methods filter', async () => {
    const { service, policies, methods } = createContext()
    mockedFindOneWithDecryption.mockResolvedValue({
      id: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      deletedAt: null,
    } as never)
    policies.push({
      id: 'policy-1',
      scope: EnforcementScope.TENANT,
      tenantId: 'tenant-1',
      organizationId: null,
      isEnforced: true,
      allowedMethods: ['passkey'],
      enforcementDeadline: null,
      enforcedBy: 'admin-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    })
    methods.push({
      id: 'method-1',
      userId: 'user-1',
      type: 'totp',
      isActive: true,
      deletedAt: null,
    })

    const result = await service.checkUserCompliance('user-1')

    expect(result).toEqual({ compliant: false, enforced: true, deadline: undefined })
  })
})
