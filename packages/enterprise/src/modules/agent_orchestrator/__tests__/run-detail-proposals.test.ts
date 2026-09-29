/** @jest-environment node */
import { GET } from '../api/runs/[id]/route'
import { mapRunDetail } from '../components/types'

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

const PROPOSAL = {
  id: '66666666-6666-4666-8666-666666666666',
  agentId: 'deals.health_check',
  runId: RUN_ID,
  payload: {
    actions: [{ type: 'set_stage', payload: { stage: 'nurture' } }],
    confidence: 0.85,
    rationale: 'Engagement recency and stage age sit inside the auto-nurture range.',
  },
  disposition: 'pending',
}

function makeRequest() {
  return new Request(`http://localhost/api/agent_orchestrator/runs/${RUN_ID}`)
}

const params = Promise.resolve({ id: RUN_ID })

async function setup(proposals: unknown[]) {
  const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const { findOneWithDecryption, findWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user', tenantId: TENANT, orgId: ORG })
  ;(findOneWithDecryption as jest.Mock).mockResolvedValue({
    id: RUN_ID,
    agentId: 'deals.health_check',
    tenantId: TENANT,
    organizationId: ORG,
  })
  ;(findWithDecryption as jest.Mock).mockImplementation(
    async (_em: unknown, entity: { name?: string }) => (entity?.name === 'AgentProposal' ? proposals : []),
  )
  const find = jest.fn(async () => [])
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (token: string) => (token === 'em' ? { fork: () => ({ find }) } : null),
  })
  return { find, findWithDecryption: findWithDecryption as jest.Mock }
}

describe('GET /api/agent_orchestrator/runs/:id — proposals (reasoning) in run detail', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns the run detail with its proposals read through decryption', async () => {
    const { findWithDecryption } = await setup([PROPOSAL])
    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.proposals).toHaveLength(1)
    expect(body.proposals[0]).toMatchObject({ id: PROPOSAL.id, runId: RUN_ID })
    const proposalCall = findWithDecryption.mock.calls.find(
      (call) => (call[1] as { name?: string })?.name === 'AgentProposal',
    )
    expect(proposalCall).toBeDefined()
    expect(proposalCall![2]).toMatchObject({ runId: RUN_ID, tenantId: TENANT, deletedAt: null })
    expect(proposalCall![3]).toMatchObject({ orderBy: { createdAt: 'asc' } })
    expect(proposalCall![4]).toMatchObject({ tenantId: TENANT, organizationId: ORG })
  })

  it('returns proposals: [] when the run has none', async () => {
    await setup([])
    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.proposals).toEqual([])
  })

  it('maps the persisted payload.rationale onto the proposal view', async () => {
    await setup([PROPOSAL])
    const res = await GET(makeRequest(), { params })
    const body = await res.json()
    const detail = mapRunDetail(body)
    expect(detail).not.toBeNull()
    expect(detail!.proposals).toHaveLength(1)
    expect(detail!.proposals[0].rationale).toBe(
      'Engagement recency and stage age sit inside the auto-nurture range.',
    )
  })

  it('still 404s an unknown run without querying proposals', async () => {
    const { findWithDecryption } = await setup([PROPOSAL])
    const { findOneWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(null)
    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(404)
    const proposalCall = findWithDecryption.mock.calls.find(
      (call) => (call[1] as { name?: string })?.name === 'AgentProposal',
    )
    expect(proposalCall).toBeUndefined()
  })
})
