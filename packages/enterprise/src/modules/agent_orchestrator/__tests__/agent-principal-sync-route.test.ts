/** @jest-environment node */
import { z } from 'zod'
import type { AgentRegistryEntry } from '../lib/sdk/defineAgent'

const loadAcl = jest.fn()
const findWithDecryption = jest.fn()
const getAuthFromRequest = jest.fn()
const getAgentEntry = jest.fn()
const resolveScope = jest.fn()
const syncAgentPrincipals = jest.fn()

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

jest.mock('../lib/sdk/defineAgent', () => ({
  ensureAgentsLoaded: jest.fn(async () => {}),
  getAgentEntry: (...args: unknown[]) => getAgentEntry(...args),
}))

jest.mock('../lib/identity/syncAgentPrincipals', () => ({
  syncAgentPrincipals: (...args: unknown[]) => syncAgentPrincipals(...args),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG = '33333333-3333-4333-8333-333333333333'

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

const DECLARED = entry({ id: 'claims.triage', principal: { roleFeatures: ['claims.view'], toolAcl: 'intersect' } })
const PLAIN = entry({ id: 'plain.agent' })

function emptyResult() {
  return { created: [] as string[], synced: [] as string[], reused: [] as string[], disabled: [] as string[], droppedFeatures: {} }
}

beforeEach(() => {
  loadAcl.mockReset().mockResolvedValue({ features: ['agent_orchestrator.identity.manage'], isSuperAdmin: false, organizations: null })
  findWithDecryption.mockReset().mockResolvedValue([
    { tenantId: TENANT, organizationId: ORG, agentDefinitionId: 'claims.triage', enabled: true },
  ])
  getAuthFromRequest.mockReset().mockResolvedValue({ sub: 'user-1', tenantId: TENANT, orgId: ORG })
  getAgentEntry.mockReset().mockImplementation((id: string) => [DECLARED, PLAIN].find((candidate) => candidate.id === id))
  resolveScope.mockReset().mockResolvedValue({ selectedId: ORG, filterIds: [ORG], allowedIds: [ORG], tenantId: TENANT })
  syncAgentPrincipals.mockReset().mockResolvedValue({ ...emptyResult(), created: ['claims.triage'] })
})

async function postSync(id: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import('../api/agents/[id]/principal/sync/route')
  const response = await POST(
    new Request(`http://localhost/api/agent_orchestrator/agents/${id}/principal/sync`, { method: 'POST' }),
    { params: Promise.resolve({ id }) },
  )
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

describe('POST /api/agent_orchestrator/agents/:id/principal/sync', () => {
  it('declares identity.manage as the route guard', async () => {
    const { metadata } = await import('../api/agents/[id]/principal/sync/route')
    expect(metadata.POST).toEqual({ requireAuth: true, requireFeatures: ['agent_orchestrator.identity.manage'] })
  })

  it('returns 403 without identity.manage in the selected organization and never syncs', async () => {
    loadAcl.mockResolvedValue({ features: ['agent_orchestrator.agents.manage'], isSuperAdmin: false, organizations: null })
    const { status } = await postSync('claims.triage')
    expect(status).toBe(403)
    expect(syncAgentPrincipals).not.toHaveBeenCalled()
  })

  it('accepts a wildcard grant', async () => {
    loadAcl.mockResolvedValue({ features: ['agent_orchestrator.*'], isSuperAdmin: false, organizations: null })
    expect((await postSync('claims.triage')).status).toBe(200)
  })

  it('returns 404 for an unknown agent', async () => {
    const { status } = await postSync('missing.agent')
    expect(status).toBe(404)
    expect(syncAgentPrincipals).not.toHaveBeenCalled()
  })

  it('returns 422 agent_principal_not_declared when the agent declares no principal', async () => {
    const { status, body } = await postSync('plain.agent')
    expect(status).toBe(422)
    expect(body.code).toBe('agent_principal_not_declared')
    expect(syncAgentPrincipals).not.toHaveBeenCalled()
  })

  it('syncs only that agent in the selected organization and returns the refreshed summary', async () => {
    const { status, body } = await postSync('claims.triage')
    expect(status).toBe(200)
    expect(syncAgentPrincipals).toHaveBeenCalledTimes(1)
    const [, scope, options] = syncAgentPrincipals.mock.calls[0]
    expect(scope).toEqual({ tenantId: TENANT, organizationId: ORG })
    expect(options).toEqual({ agents: [DECLARED], disableUndeclared: false })
    expect(body).toEqual({
      agentId: 'claims.triage',
      outcome: 'created',
      droppedFeatures: [],
      principal: {
        declared: true,
        provisioned: true,
        enabled: true,
        toolAcl: 'intersect',
        required: false,
        roleFeatures: ['claims.view'],
      },
    })
    const [, , where, , findScope] = findWithDecryption.mock.calls[0]
    expect(where).toMatchObject({ tenantId: TENANT, organizationId: ORG, agentDefinitionId: { $in: ['claims.triage'] } })
    expect(findScope).toEqual({ tenantId: TENANT, organizationId: ORG })
  })

  it('scopes the sync and ACL to the selected organization of the caller tenant', async () => {
    resolveScope.mockResolvedValue({ selectedId: OTHER_ORG, filterIds: [OTHER_ORG], allowedIds: [ORG, OTHER_ORG], tenantId: TENANT })
    syncAgentPrincipals.mockResolvedValue({ ...emptyResult(), reused: ['claims.triage'] })
    const { status, body } = await postSync('claims.triage')
    expect(status).toBe(200)
    expect(body.outcome).toBe('reused')
    expect(loadAcl.mock.calls[0][1]).toEqual({ tenantId: TENANT, organizationId: OTHER_ORG })
    expect(syncAgentPrincipals.mock.calls[0][1]).toEqual({ tenantId: TENANT, organizationId: OTHER_ORG })
  })

  it('reports dropped features and maps a sync failure to a minimal 500', async () => {
    syncAgentPrincipals.mockResolvedValueOnce({ ...emptyResult(), synced: ['claims.triage'], droppedFeatures: { 'claims.triage': ['bogus.feature'] } })
    const first = await postSync('claims.triage')
    expect(first.body).toMatchObject({ outcome: 'synced', droppedFeatures: ['bogus.feature'] })

    syncAgentPrincipals.mockRejectedValueOnce(new Error('db down'))
    const failed = await postSync('claims.triage')
    expect(failed.status).toBe(500)
    expect(failed.body).toEqual({ error: 'Principal sync failed' })
  })

  it('requires a tenant and an organization', async () => {
    getAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: null, orgId: null })
    expect((await postSync('claims.triage')).status).toBe(400)
    getAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT, orgId: null })
    resolveScope.mockResolvedValue({ selectedId: null, filterIds: null, allowedIds: null, tenantId: TENANT })
    expect((await postSync('claims.triage')).status).toBe(400)
    expect(syncAgentPrincipals).not.toHaveBeenCalled()
  })
})
