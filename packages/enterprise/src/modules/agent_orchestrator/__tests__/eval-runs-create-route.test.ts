/** @jest-environment node */
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { POST, openApi } from '../api/eval-runs/route'
import { EVAL_SET_FORMAT, EVAL_SET_FORMAT_VERSION, hashManifest } from '../lib/eval/manifest'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('../lib/eval/evalReplayService', () => ({
  replaySuiteRun: jest.fn(async () => undefined),
}))

const mockEnqueue = jest.fn(async () => undefined)

jest.mock('../lib/queue', () => ({
  AGENT_ORCHESTRATOR_EVAL_SUITE_QUEUE: 'agent-orchestrator-eval-suite',
  getAgentOrchestratorQueue: () => ({ enqueue: mockEnqueue }),
}))

const { getAuthFromRequest } = jest.requireMock('@open-mercato/shared/lib/auth/server') as {
  getAuthFromRequest: jest.Mock
}
const { createRequestContainer } = jest.requireMock('@open-mercato/shared/lib/di/container') as {
  createRequestContainer: jest.Mock
}

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const SUITE_RUN_ID = '33333333-3333-4333-8333-333333333333'
const CASE_ID = '44444444-4444-4444-8444-444444444444'
const AGENT_ID = 'deals.health_check'

const SNAPSHOT_HASH = hashManifest({
  format: EVAL_SET_FORMAT,
  formatVersion: EVAL_SET_FORMAT_VERSION,
  agentId: AGENT_ID,
  label: null,
  source: 'db',
  assertions: [],
  cases: [],
})

const mockExecute = jest.fn()

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/agent_orchestrator/eval-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function startInputs(): Array<Record<string, unknown>> {
  return mockExecute.mock.calls
    .filter(([commandId]) => commandId === 'agent_orchestrator.evalRuns.start')
    .map(([, payload]) => (payload as { input: Record<string, unknown> }).input)
}

beforeEach(() => {
  jest.clearAllMocks()
  getAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT, orgId: ORG })
  createRequestContainer.mockResolvedValue({
    resolve: (key: string) => (key === 'commandBus' ? { execute: mockExecute } : null),
  })
  mockExecute.mockImplementation(async (commandId: string) => {
    if (commandId === 'agent_orchestrator.evalRuns.start') {
      return { result: { suiteRunId: SUITE_RUN_ID, caseRunCount: 2 } }
    }
    return { result: { suiteRunId: SUITE_RUN_ID, status: 'completed', outcome: 'passed', passScore: 1 } }
  })
})

describe('POST /api/agent_orchestrator/eval-runs — snapshot pinning', () => {
  it.each([
    ['latest', 'latest'],
    ['a computed manifest hash', SNAPSHOT_HASH],
  ])('accepts snapshot %s without evalCaseIds', async (_label, snapshot) => {
    const response = await POST(postRequest({ agentDefinitionId: AGENT_ID, snapshot }))
    expect(response.status).toBe(200)
    const [input] = startInputs()
    expect(input.snapshot).toBe(snapshot)
    expect(input).not.toHaveProperty('evalCaseIds')
  })

  it('forwards evalCaseIds alongside a snapshot to narrow the manifest cases', async () => {
    const response = await POST(postRequest({ agentDefinitionId: AGENT_ID, snapshot: 'latest', evalCaseIds: [CASE_ID] }))
    expect(response.status).toBe(200)
    expect(startInputs()[0]).toMatchObject({ snapshot: 'latest', evalCaseIds: [CASE_ID] })
  })

  it('queues a snapshot run whose case-run count exceeds the inline limit', async () => {
    mockExecute.mockImplementation(async () => ({ result: { suiteRunId: SUITE_RUN_ID, caseRunCount: 12 } }))
    const response = await POST(postRequest({ agentDefinitionId: AGENT_ID, snapshot: 'latest' }))
    expect(response.status).toBe(202)
    expect(mockEnqueue).toHaveBeenCalledWith({ suiteRunId: SUITE_RUN_ID })
  })

  it.each([
    ['an unknown keyword', 'current'],
    ['a short hash', 'sha256:abc'],
    ['an uppercase hash', SNAPSHOT_HASH.toUpperCase()],
    ['a hash without prefix', SNAPSHOT_HASH.slice('sha256:'.length)],
  ])('rejects %s as a malformed snapshot with 400', async (_label, snapshot) => {
    const response = await POST(postRequest({ agentDefinitionId: AGENT_ID, snapshot }))
    expect(response.status).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('still requires evalCaseIds when no snapshot is given', async () => {
    const response = await POST(postRequest({ agentDefinitionId: AGENT_ID }))
    expect(response.status).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('keeps the unpinned selection path unchanged', async () => {
    const response = await POST(postRequest({ agentDefinitionId: AGENT_ID, evalCaseIds: [CASE_ID] }))
    expect(response.status).toBe(200)
    const [input] = startInputs()
    expect(input).toMatchObject({ evalCaseIds: [CASE_ID] })
    expect(input).not.toHaveProperty('snapshot')
  })

  it('answers 404 with eval_set_unresolved when the hash is unknown in scope', async () => {
    mockExecute.mockRejectedValue(
      new CrudHttpError(404, { error: '[internal] eval set snapshot not found for this agent', code: 'eval_set_unresolved' }),
    )
    const response = await POST(postRequest({ agentDefinitionId: AGENT_ID, snapshot: SNAPSHOT_HASH }))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'eval_set_unresolved' })
  })

  it('documents the snapshot field and the unresolved-snapshot error', () => {
    const post = openApi.methods?.POST
    expect(post?.requestBody).toBeDefined()
    expect(post?.errors?.map((entry) => entry.status)).toContain(404)
  })
})
