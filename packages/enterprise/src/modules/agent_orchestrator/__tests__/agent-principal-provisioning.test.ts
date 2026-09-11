import { provisionAgentPrincipal } from '../lib/identity/agentPrincipalService'
import { AgentPrincipal } from '../data/entities'
import { User, Role, RoleAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'

/**
 * In-memory EntityManager fake covering the surface the provisioning service uses
 * (transactional, findOne with simple equality where-clauses, create, persist,
 * flush). Idempotency (one User/Role/AgentPrincipal per (org, agentDefinitionId))
 * and the non-interactive-credential property are behaviors of
 * provisionAgentPrincipal, so a fake EM exercises them without a DB; the
 * DB-backed path lives in integration.
 */
function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  const pending = new Set<Record<string, unknown>>()
  let idSeq = 0

  function storeFor(entity: unknown): Array<Record<string, unknown>> {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  function matchValue(rowValue: unknown, condition: unknown): boolean {
    if (condition === null) return rowValue === null || rowValue === undefined
    if (rowValue instanceof Date && condition instanceof Date) {
      return rowValue.getTime() === condition.getTime()
    }
    return rowValue === condition
  }
  function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      // Relation filters (e.g. { user }, { role }) compare the linked object identity.
      return matchValue(row[key], value)
    })
  }

  const em = {
    create(entity: unknown, data: Record<string, unknown>) {
      const row: Record<string, unknown> = { ...data }
      ;(row as { __entity?: unknown }).__entity = entity
      return row
    },
    persist(row: Record<string, unknown>) {
      pending.add(row)
      return em
    },
    async flush() {
      for (const row of Array.from(pending)) {
        if (!row.id) row.id = `id-${++idSeq}`
        const entity = (row as { __entity?: unknown }).__entity
        const store = storeFor(entity)
        // Mirror the identity map: re-persisting a managed row is a no-op append.
        if (!store.includes(row)) store.push(row)
        pending.delete(row)
      }
    },
    async findOne(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async transactional<T>(cb: (tem: typeof em) => Promise<T>): Promise<T> {
      return cb(em)
    },
    // Expose the stores for assertions.
    __stores: stores,
  }
  return em
}

function createContainer(em: ReturnType<typeof createFakeEm>) {
  return {
    resolve(name: string) {
      if (name === 'em') {
        // The service forks the resolved em; return one whose .fork() yields the
        // same fake instance so all reads/writes share one in-memory store.
        return { ...em, fork: () => em }
      }
      throw new Error(`[test] unexpected resolve(${name})`)
    },
  } as unknown as import('awilix').AwilixContainer
}

const SCOPE = { tenantId: 'tenant-A', organizationId: 'org-A' }
const INPUT = {
  agentDefinitionId: 'deals.health_check',
  displayName: 'Deals Health Check',
  roleFeatures: ['customers.deals.view'],
  credentialMode: 'internal' as const,
}

describe('provisionAgentPrincipal', () => {
  it('provisions an agent User (kind=agent) + a scoped Role, attributed to a concrete user id', async () => {
    const em = createFakeEm()
    const container = createContainer(em)

    const result = await provisionAgentPrincipal(container, SCOPE, INPUT)

    const users = em.__stores.get(User) ?? []
    const roles = em.__stores.get(Role) ?? []
    const principals = em.__stores.get(AgentPrincipal) ?? []

    expect(users).toHaveLength(1)
    expect(users[0].kind).toBe('agent')
    expect(roles).toHaveLength(1)
    expect(roles[0].name).toBe('agent:deals.health_check')
    expect(principals).toHaveLength(1)

    // Internal-agent attribution: the principal resolves to the concrete User id.
    expect(result.userId).toBe(users[0].id)
    expect(result.roleId).toBe(roles[0].id)
    expect(result.principal.agentDefinitionId).toBe('deals.health_check')
  })

  it('is org-scoped: every provisioned row carries tenant_id + organization_id', async () => {
    const em = createFakeEm()
    const result = await provisionAgentPrincipal(createContainer(em), SCOPE, INPUT)
    expect(result.principal.tenantId).toBe('tenant-A')
    expect(result.principal.organizationId).toBe('org-A')
    const users = em.__stores.get(User) ?? []
    expect(users[0].tenantId).toBe('tenant-A')
    expect(users[0].organizationId).toBe('org-A')
  })

  it('internal credentialMode grants NO interactive credential (no password, unconfirmed)', async () => {
    const em = createFakeEm()
    const result = await provisionAgentPrincipal(createContainer(em), SCOPE, INPUT)

    const users = em.__stores.get(User) ?? []
    expect(users[0].passwordHash).toBeNull()
    expect(users[0].isConfirmed).toBe(false)
    // The interactive login flow has no credential to verify against.
    expect(result.interactiveLoginDisabled).toBe(true)
    expect(result.principal.credentialMode).toBe('internal')
  })

  it('grants the scoped role a least-privilege (non-super-admin) ACL with the requested features', async () => {
    const em = createFakeEm()
    await provisionAgentPrincipal(createContainer(em), SCOPE, INPUT)
    const acls = em.__stores.get(RoleAcl) ?? []
    expect(acls).toHaveLength(1)
    expect(acls[0].isSuperAdmin).toBe(false)
    expect(acls[0].featuresJson).toEqual(['customers.deals.view'])
    expect(acls[0].organizationsJson).toEqual(['org-A'])
  })

  it('links the agent User to its scoped role', async () => {
    const em = createFakeEm()
    await provisionAgentPrincipal(createContainer(em), SCOPE, INPUT)
    const links = em.__stores.get(UserRole) ?? []
    expect(links).toHaveLength(1)
  })

  it('is idempotent: a second call returns the same principal with no duplicate rows', async () => {
    const em = createFakeEm()
    const container = createContainer(em)

    const first = await provisionAgentPrincipal(container, SCOPE, INPUT)
    const second = await provisionAgentPrincipal(container, SCOPE, INPUT)

    expect(second.principal.id).toBe(first.principal.id)
    expect(second.userId).toBe(first.userId)
    expect(second.roleId).toBe(first.roleId)

    expect(em.__stores.get(User) ?? []).toHaveLength(1)
    expect(em.__stores.get(Role) ?? []).toHaveLength(1)
    expect(em.__stores.get(RoleAcl) ?? []).toHaveLength(1)
    expect(em.__stores.get(UserRole) ?? []).toHaveLength(1)
    expect(em.__stores.get(AgentPrincipal) ?? []).toHaveLength(1)
  })

  it('merges newly-requested role features on re-provision (idempotent ACL grant)', async () => {
    const em = createFakeEm()
    const container = createContainer(em)

    await provisionAgentPrincipal(container, SCOPE, INPUT)
    await provisionAgentPrincipal(container, SCOPE, {
      ...INPUT,
      roleFeatures: ['customers.deals.view', 'customers.deals.edit'],
    })

    const acls = em.__stores.get(RoleAcl) ?? []
    expect(acls).toHaveLength(1)
    expect(acls[0].featuresJson).toEqual(['customers.deals.view', 'customers.deals.edit'])
  })
})
