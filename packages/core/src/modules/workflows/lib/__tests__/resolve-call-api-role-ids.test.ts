/**
 * @jest-environment node
 *
 * Regression tests for resolveCallApiRoleIds — the CALL_API role resolver
 * must resolve roles from the workflow instance's triggering user
 * (metadata.initiatedBy) when available, and only fall back to the
 * definition author for instances with no human initiator. This prevents
 * privilege escalation where any user with `workflows.instances.create`
 * could run an admin-authored workflow's CALL_API step with admin roles.
 */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

jest.mock('../../data/entities', () => ({
  WorkflowDefinition: class WorkflowDefinition {},
}))

jest.mock('../../../auth/data/entities', () => ({
  User: class User {},
  UserRole: class UserRole {},
  Role: class Role {},
}))

const resolvePrincipalMock = jest.fn(async () => null as string | null)
jest.mock('../../../auth/lib/executionPrincipal', () => ({
  normalizeFeatureList: (value: unknown) =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [],
  provisionExecutionPrincipal: jest.fn(),
  resolveExecutionPrincipalUserId: (...args: unknown[]) => resolvePrincipalMock(...(args as [])),
}))

import { resolveCallApiRoleIds, resolveWorkflowPrincipalUserId } from '../activity-executor'
import {
  findOneWithDecryption,
  findWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'

const mockFindOne = findOneWithDecryption as jest.Mock
const mockFindMany = findWithDecryption as jest.Mock

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'
const DEFINITION_ID = 'def-1'
const AUTHOR_ID = 'author-admin'
const INITIATOR_ID = 'initiator-low-priv'
const PRINCIPAL_ID = 'workflow-execution-principal'

type FindOneCall = { entity: string; filter: Record<string, unknown> }

function entityName(arg: unknown): string {
  if (typeof arg === 'function') return arg.name
  if (arg && typeof arg === 'object' && 'name' in (arg as Record<string, unknown>)) {
    return String((arg as { name?: string }).name)
  }
  return ''
}

function setupCommonStubs({
  authorExists = true,
  initiatorExists = true,
  authorRoleIds = ['role-admin'],
  initiatorRoleIds = ['role-low-priv'],
  definitionDeletedAt = null,
  grantedFeatures = null,
  principalRoleIds = ['role-granted'],
}: {
  authorExists?: boolean
  initiatorExists?: boolean
  authorRoleIds?: string[]
  initiatorRoleIds?: string[]
  definitionDeletedAt?: Date | null
  grantedFeatures?: string[] | null
  principalRoleIds?: string[]
} = {}) {
  mockFindOne.mockReset()
  mockFindMany.mockReset()
  resolvePrincipalMock.mockReset()
  resolvePrincipalMock.mockResolvedValue(PRINCIPAL_ID)

  mockFindOne.mockImplementation(async (_em: unknown, Entity: any, filter: Record<string, unknown>) => {
    const name = entityName(Entity)
    if (name === 'WorkflowDefinition') {
      return {
        id: filter.id,
        createdBy: AUTHOR_ID,
        tenantId: filter.tenantId,
        organizationId: ORG_ID,
        grantedFeatures,
        deletedAt: definitionDeletedAt,
      }
    }
    if (name === 'User') {
      if (filter.id === AUTHOR_ID && authorExists) return { id: AUTHOR_ID }
      if (filter.id === INITIATOR_ID && initiatorExists) return { id: INITIATOR_ID }
      if (filter.id === PRINCIPAL_ID) return { id: PRINCIPAL_ID }
      return null
    }
    return null
  })

  mockFindMany.mockImplementation(async (_em: unknown, Entity: any, filter: Record<string, unknown>) => {
    const name = entityName(Entity)
    if (name === 'UserRole') {
      const userFilter = filter.user as string | undefined
      const ids =
        userFilter === PRINCIPAL_ID
          ? principalRoleIds
          : userFilter === INITIATOR_ID
            ? initiatorRoleIds
            : authorRoleIds
      return ids.map((id) => ({ role: { id } }))
    }
    if (name === 'Role') {
      const idFilter = filter.id as { $in?: string[] } | string | undefined
      const ids = Array.isArray((idFilter as any)?.$in) ? (idFilter as any).$in : []
      return ids.map((id: string) => ({ id }))
    }
    return []
  })
}

function findOneCalls(): FindOneCall[] {
  return mockFindOne.mock.calls.map((args) => ({
    entity: entityName(args[1]),
    filter: args[2] as Record<string, unknown>,
  }))
}

describe('resolveCallApiRoleIds', () => {
  test('uses the initiator\'s roles when metadata.initiatedBy is set, ignoring the author', async () => {
    setupCommonStubs({
      authorRoleIds: ['role-admin'],
      initiatorRoleIds: ['role-low-priv'],
    })

    const result = await resolveCallApiRoleIds({}, {
      id: 'inst-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      definitionId: DEFINITION_ID,
      metadata: { initiatedBy: INITIATOR_ID },
    })

    expect(result).toEqual(['role-low-priv'])

    const calls = findOneCalls()
    const userCalls = calls.filter((c) => c.entity === 'User')
    expect(userCalls.map((c) => c.filter.id)).toEqual([INITIATOR_ID])

    // The definition IS read even when an initiator is present — it is the only
    // place a declared execution grant can be discovered, and a grant outranks
    // the initiator. With no grant declared the initiator still wins.
    const definitionCalls = calls.filter((c) => c.entity === 'WorkflowDefinition')
    expect(definitionCalls.length).toBe(1)
  })

  test('refuses to run when the initiator has no active scoped roles (never falls back to author)', async () => {
    setupCommonStubs({
      initiatorRoleIds: [],
      authorRoleIds: ['role-admin'],
    })

    const result = await resolveCallApiRoleIds({}, {
      id: 'inst-2',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      definitionId: DEFINITION_ID,
      metadata: { initiatedBy: INITIATOR_ID },
    })

    expect(result).toEqual([])

    const calls = findOneCalls()
    // Author user must not be consulted once initiator was resolved.
    expect(calls.some((c) => c.entity === 'User' && c.filter.id === AUTHOR_ID)).toBe(false)
  })

  test('refuses to run when the initiator user does not exist', async () => {
    setupCommonStubs({ initiatorExists: false })

    const result = await resolveCallApiRoleIds({}, {
      id: 'inst-3',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      definitionId: DEFINITION_ID,
      metadata: { initiatedBy: INITIATOR_ID },
    })

    expect(result).toEqual([])

    const calls = findOneCalls()
    expect(calls.some((c) => c.entity === 'User' && c.filter.id === AUTHOR_ID)).toBe(false)
  })

  test('falls back to the definition author for event-triggered instances with no initiator', async () => {
    setupCommonStubs({ authorRoleIds: ['role-admin'] })

    const result = await resolveCallApiRoleIds({}, {
      id: 'inst-4',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      definitionId: DEFINITION_ID,
      metadata: null,
    })

    expect(result).toEqual(['role-admin'])

    const calls = findOneCalls()
    expect(calls.some((c) => c.entity === 'WorkflowDefinition')).toBe(true)
    expect(calls.some((c) => c.entity === 'User' && c.filter.id === AUTHOR_ID)).toBe(true)
  })

  test('falls back to the author when metadata exists but initiatedBy is empty', async () => {
    setupCommonStubs({ authorRoleIds: ['role-admin'] })

    const result = await resolveCallApiRoleIds({}, {
      id: 'inst-5',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      definitionId: DEFINITION_ID,
      metadata: { initiatedBy: null },
    })

    expect(result).toEqual(['role-admin'])
  })

  test('a soft-deleted definition never mints a key through the author fallback', async () => {
    setupCommonStubs({ definitionDeletedAt: new Date() })

    const result = await resolveCallApiRoleIds({}, {
      id: 'inst-6',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      definitionId: DEFINITION_ID,
      metadata: null,
    })

    // The row is now fetched WITHOUT a deletedAt filter (a grant on a deleted
    // definition must still bind a run that is still executing) and the author
    // fallback is refused in code instead.
    expect(result).toEqual([])
    const definitionCall = findOneCalls().find((c) => c.entity === 'WorkflowDefinition')
    expect(definitionCall).toBeDefined()
    expect(definitionCall!.filter.deletedAt).toBeUndefined()
  })

  test('returns empty array when no definitionId', async () => {
    setupCommonStubs()
    const result = await resolveCallApiRoleIds({}, {
      id: 'inst-7',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      definitionId: '',
      metadata: { initiatedBy: INITIATOR_ID },
    })
    expect(result).toEqual([])
  })
})

describe('a definition declaring grantedFeatures outranks both the initiator and the author', () => {
  test('CALL_API mints its one-time key from the definition principal, not the admin who started the run', async () => {
    setupCommonStubs({ grantedFeatures: ['customers.deals.view'], initiatorRoleIds: ['role-admin'] })

    const result = await resolveCallApiRoleIds({}, {
      id: 'inst-granted',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      definitionId: DEFINITION_ID,
      metadata: { initiatedBy: INITIATOR_ID },
    })

    // Without this, a granted workflow started by an admin would route straight
    // around its own grant through a CALL_API activity.
    expect(result).toEqual(['role-granted'])
    expect(findOneCalls().some((c) => c.entity === 'User' && c.filter.id === INITIATOR_ID)).toBe(false)
  })

  test('CALL_API refuses when the declared grant has no provisioned principal', async () => {
    setupCommonStubs({ grantedFeatures: ['customers.deals.view'] })
    resolvePrincipalMock.mockResolvedValue(null)

    await expect(
      resolveCallApiRoleIds({}, {
        id: 'inst-granted',
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        definitionId: DEFINITION_ID,
        metadata: { initiatedBy: INITIATOR_ID },
      }),
    ).rejects.toThrow('execution principal is not provisioned')
  })

  test('INVOKE_AGENT runs as the definition principal rather than the initiator', async () => {
    setupCommonStubs({ grantedFeatures: ['customers.deals.view'] })

    const userId = await resolveWorkflowPrincipalUserId({}, {
      id: 'inst-granted',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      definitionId: DEFINITION_ID,
      metadata: { initiatedBy: INITIATOR_ID },
    })

    expect(userId).toBe(PRINCIPAL_ID)
  })

  test('REGRESSION: without a grant, INVOKE_AGENT keeps the initiator → author chain', async () => {
    setupCommonStubs()

    expect(
      await resolveWorkflowPrincipalUserId({}, {
        id: 'inst-a',
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        definitionId: DEFINITION_ID,
        metadata: { initiatedBy: INITIATOR_ID },
      }),
    ).toBe(INITIATOR_ID)

    expect(
      await resolveWorkflowPrincipalUserId({}, {
        id: 'inst-b',
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        definitionId: DEFINITION_ID,
        metadata: null,
      }),
    ).toBe(AUTHOR_ID)
  })
})
