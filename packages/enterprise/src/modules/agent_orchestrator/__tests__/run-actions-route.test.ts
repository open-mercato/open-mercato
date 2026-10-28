/** @jest-environment node */
import { GET, metadata } from '../api/runs/[id]/actions/route'
import { buildRunActionCorrelationKeys, parseCorrelationKeys } from '../lib/identity/runActionCorrelation'

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
const OTHER_ORG = '44444444-4444-4444-8444-444444444444'
const RUN_ID = '33333333-3333-4333-8333-333333333333'
const PROPOSAL_A = '55555555-5555-4555-8555-555555555555'
const PROPOSAL_B = '66666666-6666-4666-8666-666666666666'
const AGENT_USER = '77777777-7777-4777-8777-777777777777'
const HUMAN = '88888888-8888-4888-8888-888888888888'

const RUN = { id: RUN_ID, tenantId: TENANT, organizationId: ORG }

const ENTRY = {
  id: 'log-1',
  commandId: 'customers.deals.update',
  actionLabel: 'Update deal',
  resourceKind: 'customers.deal',
  resourceId: 'deal-1',
  actorUserId: AGENT_USER,
  onBehalfOfUserId: HUMAN,
  sourceKey: 'agent',
  correlationKeys: [`agentRunId:${RUN_ID}`, `proposalId:${PROPOSAL_A}`],
  createdAt: new Date('2026-10-28T10:00:00.000Z'),
  contextJson: { secret: 'not exposed' },
}

function makeRequest(query: Record<string, string> = {}) {
  const search = new URLSearchParams(query).toString()
  return new Request(`http://localhost/api/agent_orchestrator/runs/${RUN_ID}/actions${search ? `?${search}` : ''}`)
}

const params = Promise.resolve({ id: RUN_ID })

async function setup(options: { orgId?: string; registered?: boolean; proposals?: Array<{ id: string }> } = {}) {
  const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const { findOneWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: HUMAN, tenantId: TENANT, orgId: options.orgId ?? ORG })
  ;(findOneWithDecryption as jest.Mock).mockImplementation(async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => (
    where.organizationId === RUN.organizationId && where.tenantId === RUN.tenantId && where.id === RUN.id ? RUN : null
  ))
  const find = jest.fn(async () => options.proposals ?? [{ id: PROPOSAL_A }, { id: PROPOSAL_B }])
  const listByCorrelationKeys = jest.fn(async () => ({ items: [ENTRY], total: 1 }))
  const registered = options.registered !== false
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    hasRegistration: (token: string) => token === 'actionLogService' && registered,
    resolve: (token: string) => {
      if (token === 'em') return { fork: () => ({ find }) }
      if (token === 'actionLogService') return { listByCorrelationKeys }
      return null
    },
  })
  return { find, listByCorrelationKeys }
}

describe('GET /api/agent_orchestrator/runs/:id/actions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('requires both the trace view and the tenant audit view features', () => {
    expect(metadata.GET.requireAuth).toBe(true)
    expect(metadata.GET.requireFeatures).toEqual(['agent_orchestrator.trace.view', 'audit_logs.view_tenant'])
  })

  it('lists entries correlated with the run and its proposals within the run scope', async () => {
    const { find, listByCorrelationKeys } = await setup()

    const res = await GET(makeRequest(), { params })

    expect(res.status).toBe(200)
    expect(find).toHaveBeenCalledWith(
      expect.anything(),
      { runId: RUN_ID, tenantId: TENANT, organizationId: ORG },
      { fields: ['id'] },
    )
    expect(listByCorrelationKeys).toHaveBeenCalledWith({
      tenantId: TENANT,
      organizationId: ORG,
      keys: [`agentRunId:${RUN_ID}`, `proposalId:${PROPOSAL_A}`, `proposalId:${PROPOSAL_B}`],
      page: 1,
      pageSize: 50,
    })
    const body = await res.json()
    expect(body).toEqual({
      items: [{
        id: 'log-1',
        commandId: 'customers.deals.update',
        actionLabel: 'Update deal',
        resourceKind: 'customers.deal',
        resourceId: 'deal-1',
        actorUserId: AGENT_USER,
        onBehalfOfUserId: HUMAN,
        sourceKey: 'agent',
        correlation: { agentRunId: RUN_ID, proposalId: PROPOSAL_A },
        createdAt: '2026-10-28T10:00:00.000Z',
      }],
      total: 1,
      page: 1,
      pageSize: 50,
    })
  })

  it('returns 404 for a run outside the caller organization without querying the audit log', async () => {
    const { listByCorrelationKeys } = await setup({ orgId: OTHER_ORG })

    const res = await GET(makeRequest(), { params })

    expect(res.status).toBe(404)
    expect(listByCorrelationKeys).not.toHaveBeenCalled()
  })

  it('returns 404 for a non-uuid run id', async () => {
    await setup()

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'nope' }) })

    expect(res.status).toBe(404)
  })

  it('rejects a page size above 100 and forwards an allowed page', async () => {
    const { listByCorrelationKeys } = await setup()

    const rejected = await GET(makeRequest({ pageSize: '101' }), { params })
    expect(rejected.status).toBe(400)

    const accepted = await GET(makeRequest({ page: '3', pageSize: '100' }), { params })
    expect(accepted.status).toBe(200)
    expect(listByCorrelationKeys).toHaveBeenCalledWith(expect.objectContaining({ page: 3, pageSize: 100 }))
  })

  it('returns an empty page when the audit log module is not available', async () => {
    await setup({ registered: false })

    const res = await GET(makeRequest(), { params })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [], total: 0, page: 1, pageSize: 50 })
  })

  it('returns 401 when unauthenticated', async () => {
    await setup()
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(null)

    const res = await GET(makeRequest(), { params })

    expect(res.status).toBe(401)
  })
})

describe('run action correlation keys', () => {
  it('builds the run key first and de-duplicates proposal keys', () => {
    expect(buildRunActionCorrelationKeys(RUN_ID, [PROPOSAL_A, PROPOSAL_A])).toEqual([
      `agentRunId:${RUN_ID}`,
      `proposalId:${PROPOSAL_A}`,
    ])
  })

  it('parses key:value pairs, keeps the first value per key and skips malformed entries', () => {
    expect(parseCorrelationKeys(['agentRunId:a', 'agentRunId:b', 'broken', ':x', 'y:', 'workflowInstanceId:w:1'])).toEqual({
      agentRunId: 'a',
      workflowInstanceId: 'w:1',
    })
    expect(parseCorrelationKeys(null)).toEqual({})
  })
})
