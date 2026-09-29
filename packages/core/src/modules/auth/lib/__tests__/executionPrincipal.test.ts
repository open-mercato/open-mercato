/**
 * @jest-environment node
 */
import type { AwilixContainer } from 'awilix'

type Row = Record<string, unknown>

const stores = new Map<string, Row[]>()

function storeFor(entity: unknown): Row[] {
  const name = typeof entity === 'function' ? entity.name : String(entity)
  if (!stores.has(name)) stores.set(name, [])
  return stores.get(name)!
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    const actual = row[key]
    if (value && typeof value === 'object' && 'id' in (value as Row)) {
      const target = actual as Row | undefined
      return (target?.id ?? actual) === (value as Row).id
    }
    return (actual ?? null) === (value ?? null)
  })
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: unknown, entity: unknown, where: Row) =>
    storeFor(entity).find((row) => matches(row, where)) ?? null,
  ),
}))

jest.mock('../emailHash', () => ({
  computeEmailHash: (email: string) => `hash:${email}`,
}))

jest.mock('../../data/entities', () => ({
  Role: class Role {},
  RoleAcl: class RoleAcl {},
  User: class User {},
  UserRole: class UserRole {},
}))

import {
  executionPrincipalEmail,
  executionPrincipalRoleName,
  normalizeFeatureList,
  provisionExecutionPrincipal,
  resolveExecutionPrincipalUserId,
} from '../executionPrincipal'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const SCOPE = { tenantId: TENANT, organizationId: ORG }

let idSeq = 0

function createFakeEm() {
  const pending: Row[] = []
  const em = {
    fork: () => em,
    create: (entity: unknown, data: Row) => ({ ...data, __entity: entity }) as Row,
    persist: (row: Row) => {
      pending.push(row)
      return em
    },
    flush: async () => {
      for (const row of pending.splice(0)) {
        if (!row.id) row.id = `row-${++idSeq}`
        const store = storeFor(row.__entity)
        if (!store.includes(row)) store.push(row)
      }
    },
    transactional: async <T>(cb: (trx: unknown) => Promise<T>) => cb(em),
  }
  return em
}

const fakeEm = createFakeEm()
const container = {
  resolve: (name: string) => {
    if (name === 'em') return fakeEm
    throw new Error(`[internal] unexpected resolve(${name})`)
  },
} as unknown as AwilixContainer

beforeEach(() => {
  stores.clear()
  idSeq = 0
})

describe('deterministic identity', () => {
  it('derives the email and role name from the principal key alone', () => {
    expect(executionPrincipalEmail('workflow:def-1', ORG)).toBe(
      `principal+workflow-def-1+${ORG}@agent.internal`,
    )
    expect(executionPrincipalRoleName('workflow:def-1')).toBe('principal:workflow:def-1')
  })

  it('reproduces agent_orchestrator\'s existing naming under namePrefix "agent"', () => {
    // This is what makes migrating enterprise's provisionAgentPrincipal onto this
    // helper a no-op for every ALREADY-PROVISIONED row. If these strings drift,
    // the migration silently mints duplicate principals.
    expect(executionPrincipalEmail('task:abc', ORG, 'agent')).toBe(`agent+task-abc+${ORG}@agent.internal`)
    expect(executionPrincipalRoleName('task:abc', 'agent')).toBe('agent:task:abc')
  })

  it('normalizes feature lists to a deduped, sorted, blank-free set', () => {
    expect(normalizeFeatureList([' b.view ', 'a.view', 'a.view', '', 3 as unknown as string])).toEqual([
      'a.view',
      'b.view',
    ])
  })
})

describe('provisionExecutionPrincipal', () => {
  it('creates a login-less, non-super-admin principal scoped to one organization', async () => {
    const resolved = await provisionExecutionPrincipal(container, SCOPE, {
      principalKey: 'workflow:def-1',
      displayName: 'Workflow claims',
      features: ['customers.deals.view'],
    })

    const user = storeFor('User')[0]
    expect(user.passwordHash).toBeNull()
    expect(user.isConfirmed).toBe(false)
    expect(user.kind).toBe('service')
    expect(user.tenantId).toBe(TENANT)
    expect(user.organizationId).toBe(ORG)
    expect(resolved.userId).toBe(user.id)

    const acl = storeFor('RoleAcl')[0]
    expect(acl.featuresJson).toEqual(['customers.deals.view'])
    expect(acl.isSuperAdmin).toBe(false)
    expect(acl.organizationsJson).toEqual([ORG])
    expect(storeFor('UserRole')).toHaveLength(1)
  })

  it('is idempotent: re-provisioning resolves the same rows', async () => {
    const first = await provisionExecutionPrincipal(container, SCOPE, {
      principalKey: 'workflow:def-1',
      features: ['a.view'],
    })
    const second = await provisionExecutionPrincipal(container, SCOPE, {
      principalKey: 'workflow:def-1',
      features: ['a.view'],
    })

    expect(second.userId).toBe(first.userId)
    expect(second.roleId).toBe(first.roleId)
    expect(storeFor('User')).toHaveLength(1)
    expect(storeFor('Role')).toHaveLength(1)
    expect(storeFor('RoleAcl')).toHaveLength(1)
    expect(storeFor('UserRole')).toHaveLength(1)
  })

  it('REPLACES the role ACL so a grant can be narrowed, and clears a stale super-admin flag', async () => {
    await provisionExecutionPrincipal(container, SCOPE, {
      principalKey: 'workflow:def-1',
      features: ['a.view', 'b.edit'],
    })
    const acl = storeFor('RoleAcl')[0]
    acl.isSuperAdmin = true

    await provisionExecutionPrincipal(container, SCOPE, {
      principalKey: 'workflow:def-1',
      features: ['a.view'],
    })

    // Merging could never narrow an over-granted principal, which is the whole
    // point of re-scoping on every save.
    expect(acl.featuresJson).toEqual(['a.view'])
    expect(acl.isSuperAdmin).toBe(false)
  })

  it('merges only when explicitly asked (the enterprise compatibility mode)', async () => {
    await provisionExecutionPrincipal(container, SCOPE, {
      principalKey: 'workflow:def-1',
      features: ['a.view'],
    })
    await provisionExecutionPrincipal(container, SCOPE, {
      principalKey: 'workflow:def-1',
      features: ['b.view'],
      mergeFeatures: true,
    })

    expect(storeFor('RoleAcl')[0].featuresJson).toEqual(['a.view', 'b.view'])
  })

  it('refuses to repurpose a human User resolved by the deterministic email', async () => {
    storeFor('User').push({
      id: 'human-1',
      emailHash: `hash:${executionPrincipalEmail('workflow:def-1', ORG)}`,
      tenantId: TENANT,
      deletedAt: null,
      kind: 'human',
    })

    await expect(
      provisionExecutionPrincipal(container, SCOPE, {
        principalKey: 'workflow:def-1',
        features: ['a.view'],
      }),
    ).rejects.toThrow('[internal] resolved a human User')
  })
})

describe('resolveExecutionPrincipalUserId', () => {
  it('returns null for a principal that was never provisioned', async () => {
    expect(await resolveExecutionPrincipalUserId(fakeEm as never, 'workflow:missing', SCOPE)).toBeNull()
  })

  it('resolves the same user the provisioner created', async () => {
    const resolved = await provisionExecutionPrincipal(container, SCOPE, {
      principalKey: 'workflow:def-1',
      features: ['a.view'],
    })
    expect(await resolveExecutionPrincipalUserId(fakeEm as never, 'workflow:def-1', SCOPE)).toBe(
      resolved.userId,
    )
  })
})
