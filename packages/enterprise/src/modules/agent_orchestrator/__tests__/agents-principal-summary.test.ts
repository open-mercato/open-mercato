/** @jest-environment node */
import { z } from 'zod'
import type { AgentRegistryEntry } from '../lib/sdk/defineAgent'
import { summarizeAgentPrincipal } from '../lib/identity/agentPrincipalSummary'

const loadAcl = jest.fn()
const findWithDecryption = jest.fn()
const getAuthFromRequest = jest.fn()
const listAgentEntries = jest.fn()
const getAgentEntry = jest.fn()
const resolveScope = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (key: string) => {
      if (key === 'rbacService') return { loadAcl }
      if (key === 'em') return { fork: () => ({}) }
      throw new Error(`[internal] unexpected resolve ${key}`)
    },
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveScope(...args),
}))

jest.mock('../lib/settings/agentSettings', () => ({
  getAgentPresentationMaps: jest.fn(async () => ({ icons: new Map(), tags: new Map() })),
  getAgentSettingRow: jest.fn(async () => null),
}))

jest.mock('../lib/sdk/defineAgent', () => ({
  ensureAgentsLoaded: jest.fn(async () => {}),
  listAgentEntries: (...args: unknown[]) => listAgentEntries(...args),
  getAgentEntry: (...args: unknown[]) => getAgentEntry(...args),
}))

jest.mock('../lib/sdk/defineSkill', () => ({
  ensureSkillsLoaded: jest.fn(async () => {}),
  getSkillEntry: jest.fn(() => undefined),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const MANAGER = ['agent_orchestrator.agents.view', 'agent_orchestrator.agents.manage']
const VIEWER = ['agent_orchestrator.agents.view']

function entry(overrides: Partial<AgentRegistryEntry>): AgentRegistryEntry {
  return {
    id: 'demo.agent',
    moduleId: 'agent_examples',
    resultKind: 'research',
    schema: z.object({ kind: z.literal('research'), data: z.object({}) }),
    tools: [],
    skills: [],
    subAgents: [],
    label: 'Demo',
    description: '',
    instructions: '',
    runtime: 'native',
    ...overrides,
  }
}

const DECLARED = entry({
  id: 'claims.triage',
  principal: { roleFeatures: ['claims.update', 'claims.view'], toolAcl: 'intersect', required: true },
})
const EXTERNAL = entry({ id: 'external.agent' })
const PLAIN = entry({ id: 'plain.agent' })
const DECLARED_UNSYNCED = entry({ id: 'reports.agent', principal: { roleFeatures: [] } })

type PrincipalItem = { id: string; principal?: unknown }

function principalRow(agentDefinitionId: string, enabled: boolean) {
  return { tenantId: TENANT, organizationId: ORG, agentDefinitionId, enabled }
}

beforeEach(() => {
  loadAcl.mockReset()
  findWithDecryption.mockReset().mockResolvedValue([
    principalRow('claims.triage', true),
    principalRow('external.agent', false),
  ])
  getAuthFromRequest.mockReset().mockResolvedValue({ sub: 'user-1', tenantId: TENANT, orgId: ORG })
  listAgentEntries.mockReset().mockReturnValue([DECLARED, EXTERNAL, PLAIN, DECLARED_UNSYNCED])
  getAgentEntry.mockReset().mockImplementation((id: string) =>
    [DECLARED, EXTERNAL, PLAIN, DECLARED_UNSYNCED].find((candidate) => candidate.id === id),
  )
  resolveScope.mockReset().mockResolvedValue({ selectedId: ORG, filterIds: [ORG], allowedIds: [ORG], tenantId: TENANT })
})

function grant(features: string[], isSuperAdmin = false) {
  loadAcl.mockResolvedValue({ features, isSuperAdmin, organizations: null })
}

async function listAgents(): Promise<PrincipalItem[]> {
  const { GET } = await import('../api/agents/route')
  const response = await GET(new Request('http://localhost/api/agent_orchestrator/agents'))
  expect(response.status).toBe(200)
  const body = (await response.json()) as { items: PrincipalItem[] }
  return body.items
}

async function getAgent(id: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const { GET } = await import('../api/agents/[id]/route')
  const response = await GET(new Request(`http://localhost/api/agent_orchestrator/agents/${id}`), {
    params: Promise.resolve({ id }),
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

describe('summarizeAgentPrincipal', () => {
  it('is null when the agent neither declares nor has a principal', () => {
    expect(summarizeAgentPrincipal(PLAIN, undefined)).toBeNull()
  })

  it('reports a declared but unsynced principal with the caller default tool ACL', () => {
    expect(summarizeAgentPrincipal(DECLARED_UNSYNCED, undefined)).toEqual({
      declared: true,
      provisioned: false,
      enabled: false,
      toolAcl: 'caller',
      required: false,
      roleFeatures: [],
    })
  })

  it('reports an externally registered principal without role features', () => {
    expect(summarizeAgentPrincipal(EXTERNAL, { agentDefinitionId: 'external.agent', enabled: true })).toEqual({
      declared: false,
      provisioned: true,
      enabled: true,
      toolAcl: 'caller',
      required: false,
    })
  })
})

describe('GET /api/agent_orchestrator/agents principal', () => {
  it('returns the principal summary of every agent to a manager from one scoped query', async () => {
    grant(MANAGER)
    const items = await listAgents()
    expect(items.map(({ id, principal }) => ({ id, principal }))).toEqual([
      {
        id: 'claims.triage',
        principal: {
          declared: true,
          provisioned: true,
          enabled: true,
          toolAcl: 'intersect',
          required: true,
          roleFeatures: ['claims.update', 'claims.view'],
        },
      },
      {
        id: 'external.agent',
        principal: { declared: false, provisioned: true, enabled: false, toolAcl: 'caller', required: false },
      },
      { id: 'plain.agent', principal: null },
      {
        id: 'reports.agent',
        principal: { declared: true, provisioned: false, enabled: false, toolAcl: 'caller', required: false, roleFeatures: [] },
      },
    ])
    expect(findWithDecryption).toHaveBeenCalledTimes(1)
    const [, , where, , scope] = findWithDecryption.mock.calls[0]
    expect(where).toEqual({
      tenantId: TENANT,
      organizationId: ORG,
      agentDefinitionId: { $in: ['claims.triage', 'external.agent', 'plain.agent', 'reports.agent'] },
      deletedAt: null,
    })
    expect(scope).toEqual({ tenantId: TENANT, organizationId: ORG })
  })

  it('treats a wildcard or superadmin grant as a manager', async () => {
    grant(['agent_orchestrator.*'])
    expect((await listAgents())[0]).toHaveProperty('principal')
    grant([], true)
    expect((await listAgents())[0]).toHaveProperty('principal')
  })

  it('never returns principals to a non-manager and skips the lookup', async () => {
    grant(VIEWER)
    const items = await listAgents()
    expect(items).toHaveLength(4)
    for (const item of items) expect(item).not.toHaveProperty('principal')
    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  it('scopes the lookup to the selected organization', async () => {
    const otherOrg = '33333333-3333-4333-8333-333333333333'
    resolveScope.mockResolvedValue({ selectedId: otherOrg, filterIds: [otherOrg], allowedIds: null, tenantId: TENANT })
    grant(MANAGER)
    const items = await listAgents()
    expect(findWithDecryption.mock.calls[0][2]).toMatchObject({ tenantId: TENANT, organizationId: otherOrg })
    expect(items[0].principal).toMatchObject({ declared: true, provisioned: false })
  })

  it('reads every principal as unprovisioned without a selected organization', async () => {
    resolveScope.mockResolvedValue({ selectedId: null, filterIds: null, allowedIds: null, tenantId: TENANT })
    grant(MANAGER)
    const items = await listAgents()
    expect(findWithDecryption).not.toHaveBeenCalled()
    expect(items[1].principal).toBeNull()
    expect(items[0].principal).toMatchObject({ declared: true, provisioned: false })
  })

  it('keeps listing when the principal lookup fails', async () => {
    findWithDecryption.mockRejectedValue(new Error('[internal] db down'))
    grant(MANAGER)
    const items = await listAgents()
    expect(items).toHaveLength(4)
    expect(items[0].principal).toMatchObject({ declared: true, provisioned: false })
  })
})

describe('GET /api/agent_orchestrator/agents/:id principal', () => {
  it('returns the principal summary to a manager', async () => {
    grant(MANAGER)
    const { status, body } = await getAgent('claims.triage')
    expect(status).toBe(200)
    expect(body.principal).toEqual({
      declared: true,
      provisioned: true,
      enabled: true,
      toolAcl: 'intersect',
      required: true,
      roleFeatures: ['claims.update', 'claims.view'],
    })
    expect(findWithDecryption.mock.calls[0][2]).toEqual({
      tenantId: TENANT,
      organizationId: ORG,
      agentDefinitionId: { $in: ['claims.triage'] },
      deletedAt: null,
    })
  })

  it('returns null to a manager when the agent has no principal', async () => {
    findWithDecryption.mockResolvedValue([])
    grant(MANAGER)
    const { body } = await getAgent('plain.agent')
    expect(body.principal).toBeNull()
  })

  it('omits the principal for a non-manager', async () => {
    grant(VIEWER)
    const { status, body } = await getAgent('claims.triage')
    expect(status).toBe(200)
    expect(body).not.toHaveProperty('principal')
    expect(findWithDecryption).not.toHaveBeenCalled()
  })
})
