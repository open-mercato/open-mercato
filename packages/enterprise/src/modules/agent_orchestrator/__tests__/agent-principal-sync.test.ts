const mockEmit = jest.fn(async () => undefined)
jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: (...args: unknown[]) => mockEmit(...(args as [])),
}))

type Row = Record<string, unknown> & { __entity?: unknown }

const mockProvisionCalls: Array<Record<string, unknown>> = []
const mockAcls = new Map<string, { features: string[]; isSuperAdmin: boolean }>()
let mockRoleFactory: ((name: string, tenantId: string) => Row) | null = null

jest.mock('@open-mercato/core/modules/auth/lib/executionPrincipal', () => {
  const actual = jest.requireActual('@open-mercato/core/modules/auth/lib/executionPrincipal')
  return {
    ...actual,
    provisionExecutionPrincipal: jest.fn(
      async (
        _container: unknown,
        scope: { tenantId: string; organizationId: string },
        input: { principalKey: string; features: string[]; namePrefix: string; mergeFeatures: boolean },
      ) => {
        mockProvisionCalls.push({ ...input })
        const roleName = actual.executionPrincipalRoleName(input.principalKey, input.namePrefix)
        const role = mockRoleFactory!(roleName, scope.tenantId)
        mockAcls.set(roleName, { features: [...input.features].sort(), isSuperAdmin: false })
        return { userId: `user:${roleName}`, roleId: String(role.id) }
      },
    ),
  }
})

import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { AgentPrincipal } from '../data/entities'
import { z } from 'zod'
import { defineAgent, getAgentEntry, type AgentRegistryEntry } from '../lib/sdk/defineAgent'
import {
  agentPrincipalKey,
  declarativeAgentPrincipalRoleName,
  partitionDeclaredFeatures,
  syncAgentPrincipals,
} from '../lib/identity/syncAgentPrincipals'
import { withAgentActor } from '../lib/identity/agentWriteScope'
import { normalizeAgentPrincipalDeclaration } from '../data/validators'

function createFakeEm() {
  const stores = new Map<unknown, Row[]>()
  const pending = new Set<Row>()
  let idSeq = 0
  let flushes = 0
  const storeFor = (entity: unknown): Row[] => {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) =>
      value === null ? row[key] === null || row[key] === undefined : row[key] === value,
    )
  const em = {
    fork: () => em,
    create(entity: unknown, data: Record<string, unknown>): Row {
      return { ...data, __entity: entity }
    },
    persist(row: Row) {
      pending.add(row)
      return em
    },
    async flush() {
      flushes += 1
      for (const row of Array.from(pending)) {
        if (!row.id) row.id = `id-${++idSeq}`
        const store = storeFor(row.__entity)
        if (!store.includes(row)) store.push(row)
        pending.delete(row)
      }
    },
    async findOne(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).filter((row) => matches(row, where))
    },
    rows: (entity: unknown) => storeFor(entity),
    flushCount: () => flushes,
    ensureRole(name: string, tenantId: string): Row {
      const existing = storeFor(Role).find((row) => row.name === name && row.tenantId === tenantId)
      if (existing) return existing
      const role: Row = { id: `role-${++idSeq}`, name, tenantId, __entity: Role }
      storeFor(Role).push(role)
      return role
    },
  }
  return em
}

function createContainer(em: ReturnType<typeof createFakeEm>) {
  return {
    resolve(name: string) {
      if (name === 'em') return em
      throw new Error(`[test] unexpected resolve(${name})`)
    },
  } as unknown as import('awilix').AwilixContainer
}

const SCOPE = { tenantId: 'tenant-A', organizationId: 'org-A' }
const CATALOG = ['customers.deals.view', 'customers.deals.edit', 'customers.people.view']

function agent(id: string, principal?: unknown): AgentRegistryEntry {
  return {
    id,
    moduleId: 'customers',
    label: `Agent ${id}`,
    principal: normalizeAgentPrincipalDeclaration(id, principal),
  } as AgentRegistryEntry
}

describe('syncAgentPrincipals', () => {
  let em: ReturnType<typeof createFakeEm>

  beforeEach(() => {
    em = createFakeEm()
    mockRoleFactory = (name, tenantId) => em.ensureRole(name, tenantId)
    mockProvisionCalls.length = 0
    mockAcls.clear()
    mockEmit.mockClear()
  })

  it('provisions an org-qualified, replace-semantics principal and emits registered on creation only', async () => {
    const agents = [agent('customers.deal_checker', { roleFeatures: ['customers.deals.view'] })]
    const container = createContainer(em)

    const first = await syncAgentPrincipals(container, SCOPE, { agents, featureCatalog: CATALOG })

    expect(first.created).toEqual(['customers.deal_checker'])
    expect(mockProvisionCalls[0]).toMatchObject({
      principalKey: agentPrincipalKey('customers.deal_checker', 'org-A'),
      kind: 'agent',
      namePrefix: 'agent',
      mergeFeatures: false,
      features: ['customers.deals.view'],
    })
    const principals = em.rows(AgentPrincipal)
    expect(principals).toHaveLength(1)
    expect(principals[0]).toMatchObject({
      tenantId: 'tenant-A',
      organizationId: 'org-A',
      agentDefinitionId: 'customers.deal_checker',
      enabled: true,
      credentialMode: 'internal',
    })
    expect(mockEmit).toHaveBeenCalledTimes(1)
    expect(mockEmit).toHaveBeenCalledWith(
      'agent_orchestrator.agent_principal.registered',
      expect.objectContaining({ agentPrincipalId: principals[0].id, source: 'declaration', tenantId: 'tenant-A' }),
      { persistent: true },
    )

    const flushesBefore = em.flushCount()
    const second = await syncAgentPrincipals(container, SCOPE, { agents, featureCatalog: CATALOG })
    expect(second.created).toEqual([])
    expect(second.synced).toEqual(['customers.deal_checker'])
    expect(em.rows(AgentPrincipal)).toHaveLength(1)
    expect(em.flushCount()).toBe(flushesBefore)
    expect(mockEmit).toHaveBeenCalledTimes(1)
  })

  it('narrows the principal ACL when the declaration shrinks', async () => {
    const container = createContainer(em)
    const roleName = declarativeAgentPrincipalRoleName('customers.deal_checker', 'org-A')
    await syncAgentPrincipals(container, SCOPE, {
      agents: [agent('customers.deal_checker', { roleFeatures: ['customers.deals.view', 'customers.deals.edit'] })],
      featureCatalog: CATALOG,
    })
    expect(mockAcls.get(roleName)?.features).toEqual(['customers.deals.edit', 'customers.deals.view'])

    await syncAgentPrincipals(container, SCOPE, {
      agents: [agent('customers.deal_checker', { roleFeatures: ['customers.deals.view'] })],
      featureCatalog: CATALOG,
    })
    expect(mockProvisionCalls[1]).toMatchObject({ mergeFeatures: false, features: ['customers.deals.view'] })
    expect(mockAcls.get(roleName)?.features).toEqual(['customers.deals.view'])
    expect(mockAcls.get(roleName)?.isSuperAdmin).toBe(false)
  })

  it('drops unknown feature ids and the bare super-admin grant with a warning', async () => {
    const result = await syncAgentPrincipals(createContainer(em), SCOPE, {
      agents: [agent('customers.deal_checker', { roleFeatures: ['customers.deals.view', 'nope.feature', 'customers.*', 'missing.*'] })],
      featureCatalog: CATALOG,
    })
    expect(mockProvisionCalls[0].features).toEqual(['customers.*', 'customers.deals.view'])
    expect(result.droppedFeatures['customers.deal_checker']).toEqual(['missing.*', 'nope.feature'])
  })

  it('never grants the bare super-admin wildcard and fails closed without a feature catalog', () => {
    expect(partitionDeclaredFeatures(['*', 'customers.deals.view'], new Set(CATALOG))).toEqual({
      granted: ['customers.deals.view'],
      dropped: ['*'],
    })
    expect(partitionDeclaredFeatures(['customers.deals.view'], null)).toEqual({ granted: [], dropped: ['customers.deals.view'] })
  })

  it('disables only declaratively named principals when the declaration is removed, and re-enables on re-declare', async () => {
    const container = createContainer(em)
    const externalRole = em.ensureRole('agent:customers.external', 'tenant-A')
    em.rows(AgentPrincipal).push({
      id: 'principal-external',
      tenantId: 'tenant-A',
      organizationId: 'org-A',
      agentDefinitionId: 'customers.external',
      userId: 'user-external',
      roleId: externalRole.id,
      enabled: true,
      deletedAt: null,
      __entity: AgentPrincipal,
    })
    await syncAgentPrincipals(container, SCOPE, {
      agents: [agent('customers.deal_checker', { roleFeatures: ['customers.deals.view'] })],
      featureCatalog: CATALOG,
    })

    const removed = await syncAgentPrincipals(container, SCOPE, {
      agents: [agent('customers.deal_checker')],
      featureCatalog: CATALOG,
    })
    expect(removed.disabled).toEqual(['customers.deal_checker'])
    const rows = em.rows(AgentPrincipal)
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.agentDefinitionId === 'customers.deal_checker')?.enabled).toBe(false)
    expect(rows.find((row) => row.agentDefinitionId === 'customers.external')?.enabled).toBe(true)

    const redeclared = await syncAgentPrincipals(container, SCOPE, {
      agents: [agent('customers.deal_checker', { roleFeatures: ['customers.deals.view'] })],
      featureCatalog: CATALOG,
    })
    expect(redeclared.synced).toEqual(['customers.deal_checker'])
    expect(rows.find((row) => row.agentDefinitionId === 'customers.deal_checker')?.enabled).toBe(true)
    expect(mockEmit).toHaveBeenCalledTimes(1)
  })

  it('reuses an existing live principal created outside the declaration without touching its ACL', async () => {
    const externalRole = em.ensureRole('agent:customers.deal_checker', 'tenant-A')
    em.rows(AgentPrincipal).push({
      id: 'principal-external',
      tenantId: 'tenant-A',
      organizationId: 'org-A',
      agentDefinitionId: 'customers.deal_checker',
      userId: 'user-external',
      roleId: externalRole.id,
      enabled: true,
      deletedAt: null,
      __entity: AgentPrincipal,
    })

    const result = await syncAgentPrincipals(createContainer(em), SCOPE, {
      agents: [agent('customers.deal_checker', { roleFeatures: ['customers.deals.view'] })],
      featureCatalog: CATALOG,
    })

    expect(result.reused).toEqual(['customers.deal_checker'])
    expect(mockProvisionCalls).toHaveLength(0)
    expect(em.rows(AgentPrincipal)).toHaveLength(1)
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('keeps organizations of one tenant on separate principals', async () => {
    const container = createContainer(em)
    const agents = [agent('customers.deal_checker', { roleFeatures: ['customers.deals.view'] })]
    await syncAgentPrincipals(container, SCOPE, { agents, featureCatalog: CATALOG })
    await syncAgentPrincipals(container, { tenantId: 'tenant-A', organizationId: 'org-B' }, { agents, featureCatalog: CATALOG })
    const roleIds = new Set(em.rows(AgentPrincipal).map((row) => row.roleId))
    expect(roleIds.size).toBe(2)
    expect(mockEmit).toHaveBeenCalledTimes(2)
  })

  it('refuses to run inside an agent run', async () => {
    await expect(
      withAgentActor({ agentUserId: 'agent-user' }, () =>
        syncAgentPrincipals(createContainer(em), SCOPE, { agents: [], featureCatalog: CATALOG }),
      ),
    ).rejects.toThrow('[internal] agent principal sync cannot run inside an agent run')
  })
})

describe('normalizeAgentPrincipalDeclaration', () => {
  it('normalizes role features and rejects malformed declarations', () => {
    expect(
      normalizeAgentPrincipalDeclaration('a.b', { roleFeatures: [' b.view ', 'a.view', 'b.view'], toolAcl: 'intersect', required: true }),
    ).toEqual({ roleFeatures: ['a.view', 'b.view'], toolAcl: 'intersect', required: true })
    expect(normalizeAgentPrincipalDeclaration('a.b', undefined)).toBeUndefined()
    expect(() => normalizeAgentPrincipalDeclaration('a.b', { roleFeatures: ['bad feature'] })).toThrow('[internal]')
    expect(() => normalizeAgentPrincipalDeclaration('a.b', { roleFeatures: ['*'] })).toThrow('[internal]')
    expect(() => normalizeAgentPrincipalDeclaration('a.b', { roleFeatures: [], isSuperAdmin: true })).toThrow('[internal]')
  })
})

describe('defineAgent principal', () => {
  it('stores the parsed principal declaration on the registry entry', () => {
    defineAgent({
      id: 'test.principal_agent',
      moduleId: 'agent_orchestrator',
      label: 'Principal',
      description: 'Declares a principal.',
      instructions: 'BASE',
      principal: { roleFeatures: ['customers.deals.view', ' customers.deals.view'], required: true },
      result: { kind: 'research', schema: z.object({ kind: z.literal('research') }) },
    })
    expect(getAgentEntry('test.principal_agent')?.principal).toEqual({
      roleFeatures: ['customers.deals.view'],
      required: true,
    })
    expect(() =>
      defineAgent({
        id: 'test.bad_principal_agent',
        moduleId: 'agent_orchestrator',
        label: 'Bad',
        description: 'Bad principal.',
        instructions: 'BASE',
        principal: { roleFeatures: ['*'] },
        result: { kind: 'research', schema: z.object({ kind: z.literal('research') }) },
      }),
    ).toThrow('[internal]')
    expect(getAgentEntry('test.bad_principal_agent')).toBeUndefined()
  })
})
