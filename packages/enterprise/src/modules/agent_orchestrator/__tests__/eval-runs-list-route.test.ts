/** @jest-environment node */
import { GET } from '../api/eval-runs/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findAndCountWithDecryption: jest.fn(),
}))

jest.mock('../lib/eval/evalReplayService', () => ({
  replaySuiteRun: jest.fn(async () => undefined),
}))

jest.mock('../lib/queue', () => ({
  AGENT_ORCHESTRATOR_EVAL_SUITE_QUEUE: 'agent-orchestrator-eval-suite',
  getAgentOrchestratorQueue: () => ({ enqueue: jest.fn() }),
}))

const { getAuthFromRequest } = jest.requireMock('@open-mercato/shared/lib/auth/server') as {
  getAuthFromRequest: jest.Mock
}
const { createRequestContainer } = jest.requireMock('@open-mercato/shared/lib/di/container') as {
  createRequestContainer: jest.Mock
}
const { findAndCountWithDecryption } = jest.requireMock('@open-mercato/shared/lib/encryption/find') as {
  findAndCountWithDecryption: jest.Mock
}

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'

function suiteRunRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    agentDefinitionId: 'deals.health_check',
    trigger: 'manual',
    status: 'completed',
    outcome: 'passed',
    caseCount: 2,
    errorCount: 0,
    passScore: 1,
    scoreVariance: null,
    repeatCount: 1,
    judgeMayGate: false,
    triggeredBy: null,
    evalSetVersion: null,
    summary: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date('2026-10-26T10:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  getAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT, orgId: ORG })
  createRequestContainer.mockResolvedValue({ resolve: () => ({ fork: () => ({}) }) })
})

describe('GET /api/agent_orchestrator/eval-runs', () => {
  it('lists the pin column and the frozen manifest hash without the manifest body', async () => {
    findAndCountWithDecryption.mockResolvedValue([
      [
        suiteRunRow('run-pinned', {
          evalSetVersion: 'sha256:known-one',
          summary: {
            __evalSet: {
              version: 'sha256:known-one',
              label: null,
              source: 'db',
              caseCount: 2,
              assertionCount: 1,
              carrierSuiteRunId: 'run-pinned',
              body: { cases: ['manifest body payload'] },
            },
          },
        }),
        suiteRunRow('run-legacy', { evalSetVersion: 'release-1' }),
      ],
      2,
    ])

    const response = await GET(
      new Request('http://localhost/api/agent_orchestrator/eval-runs?agentDefinitionId=deals.health_check&pageSize=100'),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { items: Array<Record<string, unknown>>; total: number }

    expect(body.total).toBe(2)
    expect(body.items[0]).toMatchObject({ id: 'run-pinned', eval_set_version: 'sha256:known-one', manifest_hash: 'sha256:known-one' })
    expect(body.items[1]).toMatchObject({ id: 'run-legacy', eval_set_version: 'release-1', manifest_hash: null })
    expect(JSON.stringify(body)).not.toContain('manifest body payload')
    const [, , where, , scope] = findAndCountWithDecryption.mock.calls[0]
    expect(where).toMatchObject({ tenantId: TENANT, organizationId: ORG, agentDefinitionId: 'deals.health_check' })
    expect(scope).toEqual({ tenantId: TENANT, organizationId: ORG })
  })
})
