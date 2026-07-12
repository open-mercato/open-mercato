/** @jest-environment node */
import { GET } from '../api/runs/[id]/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(async () => []),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const RUN_ID = '33333333-3333-4333-8333-333333333333'

const BUNDLE = {
  id: '55555555-5555-4555-8555-555555555555',
  agentRunId: RUN_ID,
  capability: 'deals.health_check',
  tokenBudget: 4000,
  tokensUsed: 3800,
  routedSources: [{ kind: 'entity', ref: 'deal-1', tokens: 3800 }],
  prunedSources: [{ kind: 'retrieval', ref: 'doc-9', reason: 'over_budget' }],
}

function makeRequest() {
  return new Request(`http://localhost/api/agent_orchestrator/runs/${RUN_ID}`)
}

const params = Promise.resolve({ id: RUN_ID })

function setupEm(bundles: unknown[]) {
  const find = jest.fn(async (entity: { name?: string }) => {
    if (entity?.name === 'AgentContextBundle') return bundles
    return []
  })
  const em = { fork: () => ({ find }) }
  return { em, find }
}

async function setup(bundles: unknown[]) {
  const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const { findOneWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user', tenantId: TENANT, orgId: ORG })
  ;(findOneWithDecryption as jest.Mock).mockResolvedValue({ id: RUN_ID, tenantId: TENANT, organizationId: ORG })
  const { em, find } = setupEm(bundles)
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (token: string) => (token === 'em' ? em : null),
  })
  return { find }
}

describe('GET /api/agent_orchestrator/runs/:id — context bundle in run detail', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns the run detail with its latest context bundle', async () => {
    const { find } = await setup([BUNDLE])
    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.contextBundle).toMatchObject({
      id: BUNDLE.id,
      capability: 'deals.health_check',
      tokenBudget: 4000,
      tokensUsed: 3800,
    })
    const bundleCall = find.mock.calls.find(
      (call) => (call[0] as { name?: string })?.name === 'AgentContextBundle',
    )
    expect(bundleCall).toBeDefined()
    expect(bundleCall![1]).toMatchObject({ agentRunId: RUN_ID, tenantId: TENANT })
    expect(bundleCall![2]).toMatchObject({ orderBy: { createdAt: 'desc' }, limit: 1 })
  })

  it('returns contextBundle: null when the run has no bundle', async () => {
    await setup([])
    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.contextBundle).toBeNull()
  })

  it('still 404s an unknown run without querying bundles', async () => {
    const { find } = await setup([BUNDLE])
    const { findOneWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(null)
    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(404)
    expect(find).not.toHaveBeenCalled()
  })
})
