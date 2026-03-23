import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  EnforcementScope,
  MfaEnforcementPolicy,
  UserMfaMethod,
} from '../../data/entities'
import { emitSecurityEvent } from '../../events'
import { MfaEnforcementService } from '../MfaEnforcementService'

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

  test('createPolicy creates new row and emits created event', async () => {
    const { service, policies } = createContext()

    const policy = await service.createPolicy(
      {
        scope: EnforcementScope.TENANT,
        tenantId: '00000000-0000-4000-8000-000000000001',
        isEnforced: true,
        allowedMethods: ['totp', 'passkey'],
      },
      'admin-1',
    )

    expect(policy.id).toBe('policy-1')
    expect(policies).toHaveLength(1)
    expect(policies[0].scope).toBe(EnforcementScope.TENANT)
    expect(mockedEmitSecurityEvent).toHaveBeenCalledWith(
      'security.enforcement.created',
      expect.objectContaining({ adminId: 'admin-1', policyId: 'policy-1' }),
    )
  })

  test('createPolicy updates existing scope policy and emits updated event', async () => {
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
    )

    expect(result.id).toBe('policy-1')
    expect(result.isEnforced).toBe(false)
    expect(result.allowedMethods).toEqual(['passkey'])
    expect(mockedEmitSecurityEvent).toHaveBeenCalledWith(
      'security.enforcement.updated',
      expect.objectContaining({ adminId: 'admin-2', policyId: 'policy-1' }),
    )
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
