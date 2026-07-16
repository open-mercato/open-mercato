/** @jest-environment node */
import { GET } from '../api/runs/[id]/route'
import { mapGuardrailCheck } from '../components/types'

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

const CHECKS = [
  {
    id: '66666666-6666-4666-8666-666666666666',
    agentRunId: RUN_ID,
    phase: 'input',
    kind: 'moderation',
    result: 'pass',
    capability: 'deals.health_check',
    guardrailSetVersion: 'v1',
    evidence: null,
  },
  {
    id: '77777777-7777-4777-8777-777777777777',
    agentRunId: RUN_ID,
    phase: 'output',
    kind: 'grounding',
    result: 'block',
    capability: 'deals.health_check',
    guardrailSetVersion: 'abc123',
    evidence: { reason: 'uncited_claim' },
  },
]

function makeRequest() {
  return new Request(`http://localhost/api/agent_orchestrator/runs/${RUN_ID}`)
}

const params = Promise.resolve({ id: RUN_ID })

function setupEm(checks: unknown[]) {
  const find = jest.fn(async (entity: { name?: string }) => {
    if (entity?.name === 'AgentGuardrailCheck') return checks
    return []
  })
  const em = { fork: () => ({ find }) }
  return { em, find }
}

async function setup(checks: unknown[]) {
  const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const { findOneWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user', tenantId: TENANT, orgId: ORG })
  ;(findOneWithDecryption as jest.Mock).mockResolvedValue({ id: RUN_ID, tenantId: TENANT, organizationId: ORG })
  const { em, find } = setupEm(checks)
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (token: string) => (token === 'em' ? em : null),
  })
  return { find }
}

describe('GET /api/agent_orchestrator/runs/:id — guardrail checks in run detail', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns the run detail with its guardrail checks, oldest first', async () => {
    const { find } = await setup(CHECKS)
    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.guardrailChecks).toHaveLength(2)
    expect(body.guardrailChecks[0]).toMatchObject({ kind: 'moderation', result: 'pass' })
    expect(body.guardrailChecks[1]).toMatchObject({ kind: 'grounding', result: 'block' })
    const checkCall = find.mock.calls.find(
      (call) => (call[0] as { name?: string })?.name === 'AgentGuardrailCheck',
    )
    expect(checkCall).toBeDefined()
    expect(checkCall![1]).toMatchObject({ agentRunId: RUN_ID, tenantId: TENANT })
    expect(checkCall![2]).toMatchObject({ orderBy: { createdAt: 'asc' } })
  })

  it('returns guardrailChecks: [] when the run has no checks', async () => {
    await setup([])
    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.guardrailChecks).toEqual([])
  })
})

describe('mapGuardrailCheck', () => {
  it('maps snake_case rows and normalizes unknown results to pass', () => {
    const view = mapGuardrailCheck({
      id: CHECKS[1].id,
      phase: 'output',
      kind: 'grounding',
      result: 'block',
      capability: 'deals.health_check',
      guardrail_set_version: 'abc123',
      evidence: { reason: 'uncited_claim' },
    })
    expect(view).toMatchObject({
      result: 'block',
      guardrailSetVersion: 'abc123',
      evidence: { reason: 'uncited_claim' },
    })
    const fallback = mapGuardrailCheck({ id: CHECKS[0].id, result: 'weird' })
    expect(fallback?.result).toBe('pass')
  })

  it('drops rows without an id', () => {
    expect(mapGuardrailCheck({ result: 'block' })).toBeNull()
  })
})
