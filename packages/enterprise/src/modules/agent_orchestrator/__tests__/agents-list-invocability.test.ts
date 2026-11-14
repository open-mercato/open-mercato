/** @jest-environment node */
import { z } from 'zod'
import type { AgentRegistryEntry } from '../lib/sdk/defineAgent'

const loadAcl = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
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

const resolveScope = jest.fn()

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveScope(...args),
}))

jest.mock('../lib/settings/agentSettings', () => ({
  getAgentPresentationMaps: jest.fn(async () => ({ icons: new Map(), tags: new Map() })),
}))

jest.mock('../lib/sdk/defineAgent', () => ({
  ensureAgentsLoaded: jest.fn(async () => {}),
  listAgentEntries: jest.fn(() => []),
}))

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

const REGISTRY: AgentRegistryEntry[] = [
  entry({ id: 'open.agent' }),
  entry({ id: 'sales.agent', requiredFeatures: ['sales.orders.view'] }),
  entry({ id: 'finance.agent', requiredFeatures: ['finance.ledger.view', 'finance.ledger.export'] }),
]

type ListedAgent = { id: string; requiredFeatures?: string[]; invocable: boolean }

async function listAgents(
  acl: { features: string[]; isSuperAdmin?: boolean },
  registry: AgentRegistryEntry[] = REGISTRY,
  auth: Record<string, unknown> = { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' },
): Promise<ListedAgent[]> {
  const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
  const { listAgentEntries } = await import('../lib/sdk/defineAgent')
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue(auth)
  ;(listAgentEntries as jest.Mock).mockReturnValue(registry)
  loadAcl.mockResolvedValue({ features: acl.features, isSuperAdmin: acl.isSuperAdmin === true, organizations: null })
  const { GET } = await import('../api/agents/route')
  const response = await GET(new Request('http://localhost/api/agent_orchestrator/agents'))
  expect(response.status).toBe(200)
  const body = (await response.json()) as { items: ListedAgent[] }
  return body.items
}

function summarize(items: ListedAgent[]) {
  return items.map(({ id, invocable }) => ({ id, invocable }))
}

describe('GET /api/agent_orchestrator/agents invocability', () => {
  const originalEnforcement = process.env.OM_AGENT_INVOKE_ENFORCEMENT

  beforeEach(() => {
    loadAcl.mockReset()
    resolveScope.mockReset().mockResolvedValue({ selectedId: 'org-1', filterIds: ['org-1'], allowedIds: ['org-1'], tenantId: 'tenant-1' })
    delete process.env.OM_AGENT_INVOKE_ENFORCEMENT
  })

  afterAll(() => {
    if (originalEnforcement === undefined) delete process.env.OM_AGENT_INVOKE_ENFORCEMENT
    else process.env.OM_AGENT_INVOKE_ENFORCEMENT = originalEnforcement
  })

  it('shows a non-manager only the agents they may invoke', async () => {
    const items = await listAgents({ features: ['agent_orchestrator.agents.view', 'sales.orders.view'] })
    expect(summarize(items)).toEqual([
      { id: 'open.agent', invocable: true },
      { id: 'sales.agent', invocable: true },
    ])
    expect(loadAcl).toHaveBeenCalledTimes(1)
    expect(loadAcl).toHaveBeenCalledWith('user-1', { tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('shows a manager every agent with its invocable flag', async () => {
    const items = await listAgents({ features: ['agent_orchestrator.agents.view', 'agent_orchestrator.agents.manage'] })
    expect(summarize(items)).toEqual([
      { id: 'open.agent', invocable: true },
      { id: 'sales.agent', invocable: false },
      { id: 'finance.agent', invocable: false },
    ])
  })

  it('honours wildcard grants for both invocability and the manager check', async () => {
    const nonManager = await listAgents({ features: ['agent_orchestrator.agents.view', 'finance.*'] })
    expect(summarize(nonManager)).toEqual([
      { id: 'open.agent', invocable: true },
      { id: 'finance.agent', invocable: true },
    ])

    const manager = await listAgents({ features: ['agent_orchestrator.*', 'sales.*'] })
    expect(summarize(manager)).toEqual([
      { id: 'open.agent', invocable: true },
      { id: 'sales.agent', invocable: true },
      { id: 'finance.agent', invocable: false },
    ])
  })

  it('treats a superadmin as a manager who may invoke every agent', async () => {
    const items = await listAgents({ features: [], isSuperAdmin: true })
    expect(summarize(items)).toEqual([
      { id: 'open.agent', invocable: true },
      { id: 'sales.agent', invocable: true },
      { id: 'finance.agent', invocable: true },
    ])
  })

  it('exposes requiredFeatures on every item to a manager, empty when the agent declares none', async () => {
    const items = await listAgents({ features: ['agent_orchestrator.agents.manage'] })
    expect(items.map(({ id, requiredFeatures }) => ({ id, requiredFeatures }))).toEqual([
      { id: 'open.agent', requiredFeatures: [] },
      { id: 'sales.agent', requiredFeatures: ['sales.orders.view'] },
      { id: 'finance.agent', requiredFeatures: ['finance.ledger.view', 'finance.ledger.export'] },
    ])
  })

  it('never echoes requiredFeatures to a non-manager', async () => {
    const items = await listAgents({ features: ['agent_orchestrator.agents.view', 'sales.orders.view'] })
    expect(items.map((item) => item.id)).toEqual(['open.agent', 'sales.agent'])
    for (const item of items) expect(item).not.toHaveProperty('requiredFeatures')
  })

  it('loads the ACL for the selected organization, not the token org', async () => {
    resolveScope.mockResolvedValue({ selectedId: 'org-selected', filterIds: ['org-selected'], allowedIds: null, tenantId: 'tenant-1' })
    await listAgents({ features: ['agent_orchestrator.agents.view'] })
    expect(loadAcl).toHaveBeenCalledWith('user-1', { tenantId: 'tenant-1', organizationId: 'org-selected' })
  })

  it('loads the tenant-level ACL when no single organization is selected', async () => {
    resolveScope.mockResolvedValue({ selectedId: null, filterIds: null, allowedIds: null, tenantId: 'tenant-1' })
    await listAgents({ features: ['agent_orchestrator.agents.view'] })
    expect(loadAcl).toHaveBeenCalledWith('user-1', { tenantId: 'tenant-1', organizationId: null })
  })

  it('loads the API key ACL for an API key caller', async () => {
    const items = await listAgents({ features: ['sales.orders.view'] }, REGISTRY, {
      sub: 'api_key:key-1',
      isApiKey: true,
      keyId: 'key-1',
      userId: 'owner-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    expect(loadAcl).toHaveBeenCalledWith('api_key:key-1', { tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(items.map((item) => item.id)).toEqual(['open.agent', 'sales.agent'])
  })

  it('skips the ACL load when no agent declares requiredFeatures', async () => {
    const items = await listAgents({ features: [] }, [entry({ id: 'open.agent' })])
    expect(loadAcl).not.toHaveBeenCalled()
    expect(summarize(items)).toEqual([{ id: 'open.agent', invocable: true }])
  })

  it('lists every agent as invocable when invoke enforcement is off', async () => {
    process.env.OM_AGENT_INVOKE_ENFORCEMENT = 'off'
    const items = await listAgents({ features: ['agent_orchestrator.agents.view'] })
    expect(summarize(items)).toEqual([
      { id: 'open.agent', invocable: true },
      { id: 'sales.agent', invocable: true },
      { id: 'finance.agent', invocable: true },
    ])
  })

  it('fails closed to unrestricted agents when the ACL cannot be loaded', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { listAgentEntries } = await import('../lib/sdk/defineAgent')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    ;(listAgentEntries as jest.Mock).mockReturnValue(REGISTRY)
    loadAcl.mockRejectedValue(new Error('[internal] rbac down'))
    const { GET } = await import('../api/agents/route')
    const response = await GET(new Request('http://localhost/api/agent_orchestrator/agents'))
    const body = (await response.json()) as { items: ListedAgent[] }
    expect(summarize(body.items)).toEqual([{ id: 'open.agent', invocable: true }])
  })
})
