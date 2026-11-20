/** @jest-environment node */
import { GET } from '../api/eval-runs/[id]/route'
import { EVAL_SET_SUMMARY_KEY, mergeSuiteSummary, stripEvalSetBody } from '../lib/eval/manifest'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const { getAuthFromRequest } = jest.requireMock('@open-mercato/shared/lib/auth/server') as {
  getAuthFromRequest: jest.Mock
}
const { createRequestContainer } = jest.requireMock('@open-mercato/shared/lib/di/container') as {
  createRequestContainer: jest.Mock
}
const { findOneWithDecryption, findWithDecryption } = jest.requireMock('@open-mercato/shared/lib/encryption/find') as {
  findOneWithDecryption: jest.Mock
  findWithDecryption: jest.Mock
}

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const SUITE_RUN_ID = '33333333-3333-4333-8333-333333333333'

const pointerFields = {
  version: 'sha256:abc',
  label: 'release-1',
  source: 'db',
  caseCount: 2,
  assertionCount: 1,
  carrierSuiteRunId: SUITE_RUN_ID,
}

beforeEach(() => {
  jest.clearAllMocks()
  getAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT, orgId: ORG })
  createRequestContainer.mockResolvedValue({
    resolve: (key: string) => (key === 'em' ? { fork: () => ({}) } : null),
  })
  findWithDecryption.mockResolvedValue([])
  findOneWithDecryption.mockResolvedValue({
    id: SUITE_RUN_ID,
    agentDefinitionId: 'deals.health_check',
    trigger: 'manual',
    status: 'completed',
    judgeMayGate: true,
    repeatCount: 1,
    caseCount: 2,
    errorCount: 0,
    evalSetVersion: 'release-1',
    summary: {
      no_pii: { passed: 2, total: 2 },
      [EVAL_SET_SUMMARY_KEY]: { ...pointerFields, body: { cases: [{ key: 'secret-case' }] } },
    },
    createdAt: new Date('2026-10-26T10:00:00.000Z'),
  })
})

describe('GET /api/agent_orchestrator/eval-runs/:id', () => {
  it('strips the frozen manifest body and keeps the pointer fields', async () => {
    const response = await GET(new Request(`http://localhost/api/agent_orchestrator/eval-runs/${SUITE_RUN_ID}`), {
      params: Promise.resolve({ id: SUITE_RUN_ID }),
    })
    expect(response.status).toBe(200)
    const payload = (await response.json()) as { run: { summary: Record<string, unknown> } }
    expect(payload.run.summary[EVAL_SET_SUMMARY_KEY]).toEqual(pointerFields)
    expect(payload.run.summary.no_pii).toEqual({ passed: 2, total: 2 })
    expect(JSON.stringify(payload)).not.toContain('secret-case')
  })
})

describe('summary helpers', () => {
  it('leaves summaries without a body untouched', () => {
    const summary = { [EVAL_SET_SUMMARY_KEY]: pointerFields }
    expect(stripEvalSetBody(summary)).toBe(summary)
    expect(stripEvalSetBody(null)).toBeNull()
  })

  it('lets an assertion key never overwrite a reserved key', () => {
    const merged = mergeSuiteSummary(
      { [EVAL_SET_SUMMARY_KEY]: pointerFields, stale: 1 },
      { [EVAL_SET_SUMMARY_KEY]: 'collision', fresh: 2 },
      { __judgeDeltas: [] },
    )
    expect(merged).toEqual({ [EVAL_SET_SUMMARY_KEY]: pointerFields, stale: 1, fresh: 2, __judgeDeltas: [] })
  })
})
