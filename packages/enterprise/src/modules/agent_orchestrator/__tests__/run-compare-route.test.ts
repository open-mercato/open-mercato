/** @jest-environment node */
import { GET } from '../api/runs/[id]/compare/route'
import { ARTIFACT_REFS, type ArtifactReadResult } from '../lib/trace/artifactStore'
import { TRACE_CONTENT_ACCESS_RESOURCE_KIND } from '../lib/trace/contentArtifactAccess'
import { AgentRun, AgentSpan } from '../data/entities'

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

const readArtifactMock = jest.fn<Promise<ArtifactReadResult>, unknown[]>()
jest.mock('../lib/trace/artifactStore', () => {
  const actual = jest.requireActual('../lib/trace/artifactStore')
  return { ...actual, readArtifact: (...args: unknown[]) => readArtifactMock(...args) }
})

const readPolicyMock = jest.fn()
jest.mock('../lib/trace/capturePolicy', () => {
  const actual = jest.requireActual('../lib/trace/capturePolicy')
  return { ...actual, readTraceCapturePolicy: (...args: unknown[]) => readPolicyMock(...args) }
})

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG = '44444444-4444-4444-8444-444444444444'
const LEFT_RUN_ID = '33333333-3333-4333-8333-333333333333'
const RIGHT_RUN_ID = '66666666-6666-4666-8666-666666666666'
const FOREIGN_RUN_ID = '77777777-7777-4777-8777-777777777777'
const USER_ID = '55555555-5555-4555-8555-555555555555'
const DAY_MS = 24 * 60 * 60 * 1000

function contentKey(name: string, ageDays = 1): string {
  const epochMs = Date.now() - ageDays * DAY_MS
  return `agent-trace-content/org_${ORG}/tenant_${TENANT}/${epochMs}_abcdef123456_${name}.json`
}

const LEFT_KEY = contentKey('left-request')
const RIGHT_KEY = contentKey('right-request')

type RunRow = { id: string; tenantId: string; organizationId: string; agentId: string; status: string; model: string }

const RUNS: RunRow[] = [
  { id: LEFT_RUN_ID, tenantId: TENANT, organizationId: ORG, agentId: 'agent.a', status: 'completed', model: 'gpt-a' },
  { id: RIGHT_RUN_ID, tenantId: TENANT, organizationId: ORG, agentId: 'agent.a', status: 'completed', model: 'gpt-a' },
  { id: FOREIGN_RUN_ID, tenantId: TENANT, organizationId: OTHER_ORG, agentId: 'agent.a', status: 'completed', model: 'gpt-a' },
]

function manifestSpan(runId: string, definitionHash: string) {
  return {
    id: `${runId}-manifest`,
    name: 'run.manifest',
    kind: 'system',
    sequence: 0,
    attributes: { 'om.agent.id': 'agent.a', 'om.agent.definition_hash': definitionHash },
  }
}

function llmSpan(runId: string, sequence: number, attributes: Record<string, unknown>) {
  return { id: `${runId}-llm-${sequence}`, name: 'llm.call', kind: 'llm', sequence, attributes }
}

const SPANS: Record<string, unknown[]> = {
  [LEFT_RUN_ID]: [
    manifestSpan(LEFT_RUN_ID, 'hash-1'),
    llmSpan(LEFT_RUN_ID, 1, { 'gen_ai.request.temperature': 0.2, 'om.content.request.key': LEFT_KEY }),
    llmSpan(LEFT_RUN_ID, 2, { 'gen_ai.request.temperature': 0.2 }),
  ],
  [RIGHT_RUN_ID]: [
    manifestSpan(RIGHT_RUN_ID, 'hash-2'),
    llmSpan(RIGHT_RUN_ID, 1, { 'gen_ai.request.temperature': 0.9, 'om.content.request.key': RIGHT_KEY }),
  ],
}

const LEFT_PAYLOAD = { schema: 'om.llm_request.v1', system: 'Be brief.', messages: [{ role: 'user', content: 'hi' }], tools: [] }
const RIGHT_PAYLOAD = { schema: 'om.llm_request.v1', system: 'Be thorough.', messages: [{ role: 'user', content: 'hi' }], tools: [] }

type SetupOptions = { features?: string[]; orgId?: string; retentionDays?: number }

function makeRequest(query: Record<string, string>, runId = LEFT_RUN_ID) {
  const search = new URLSearchParams(query)
  return new Request(`http://localhost/api/agent_orchestrator/runs/${runId}/compare?${search.toString()}`)
}

async function setup(options: SetupOptions = {}) {
  const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const { findOneWithDecryption, findWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: USER_ID, tenantId: TENANT, orgId: options.orgId ?? ORG })
  ;(findOneWithDecryption as jest.Mock).mockImplementation(
    async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity !== AgentRun) return null
      return (
        RUNS.find(
          (run) => run.id === where.id && run.tenantId === where.tenantId && run.organizationId === where.organizationId,
        ) ?? null
      )
    },
  )
  ;(findWithDecryption as jest.Mock).mockImplementation(
    async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity !== AgentSpan || where.organizationId !== ORG || where.tenantId !== TENANT) return []
      return SPANS[String(where.agentRunId)] ?? []
    },
  )
  readPolicyMock.mockResolvedValue({
    policy: { retentionDays: options.retentionDays ?? 30 },
    source: 'tenant',
    updatedAt: null,
  })
  const loadAcl = jest.fn(async () => ({
    features: options.features ?? ['agent_orchestrator.trace.view', 'agent_orchestrator.trace.view_content'],
    isSuperAdmin: false,
    organizations: null,
  }))
  const accessLog = { log: jest.fn(async () => null) }
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (token: string) => {
      if (token === 'em') return { fork: () => ({}) }
      if (token === 'rbacService') return { loadAcl }
      if (token === 'accessLogService') return accessLog
      return null
    },
  })
  return { accessLog }
}

describe('GET /api/agent_orchestrator/runs/:id/compare', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    readArtifactMock.mockReset()
  })

  it('returns 404 when the other run belongs to another organization', async () => {
    await setup()

    const res = await GET(makeRequest({ with: FOREIGN_RUN_ID }), { params: Promise.resolve({ id: LEFT_RUN_ID }) })

    expect(res.status).toBe(404)
    expect(readArtifactMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the caller organization differs from both runs', async () => {
    await setup({ orgId: OTHER_ORG })

    const res = await GET(makeRequest({ with: RIGHT_RUN_ID }), { params: Promise.resolve({ id: LEFT_RUN_ID }) })

    expect(res.status).toBe(404)
  })

  it('returns 422 for an invalid with or step', async () => {
    await setup()

    const badWith = await GET(makeRequest({ with: 'nope' }), { params: Promise.resolve({ id: LEFT_RUN_ID }) })
    const badStep = await GET(makeRequest({ with: RIGHT_RUN_ID, step: '-1' }), {
      params: Promise.resolve({ id: LEFT_RUN_ID }),
    })

    expect(badWith.status).toBe(422)
    expect(badStep.status).toBe(422)
  })

  it('diffs metadata only without trace.view_content', async () => {
    const { accessLog } = await setup({ features: ['agent_orchestrator.trace.view'] })

    const res = await GET(makeRequest({ with: RIGHT_RUN_ID }), { params: Promise.resolve({ id: LEFT_RUN_ID }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.content).toBe('forbidden')
    expect(body.left.contentStatus).toBe('forbidden')
    expect(body.right.contentStatus).toBe('forbidden')
    expect(body.diff.manifest).toEqual([{ key: 'om.agent.definition_hash', left: 'hash-1', right: 'hash-2' }])
    expect(body.diff.params).toEqual([{ key: 'gen_ai.request.temperature', left: 0.2, right: 0.9 }])
    expect(body.diff.systemPrompt).toBeUndefined()
    expect(readArtifactMock).not.toHaveBeenCalled()
    expect(accessLog.log).not.toHaveBeenCalled()
  })

  it('adds the content diff with trace.view_content and access-logs each read', async () => {
    readArtifactMock.mockImplementation(async (_container, _scope, _ref, key) => ({
      status: 'ok',
      value: key === LEFT_KEY ? LEFT_PAYLOAD : RIGHT_PAYLOAD,
    }))
    const { accessLog } = await setup()

    const res = await GET(makeRequest({ with: RIGHT_RUN_ID, step: '0' }), {
      params: Promise.resolve({ id: LEFT_RUN_ID }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.content).toBe('included')
    expect(body.left).toMatchObject({ runId: LEFT_RUN_ID, contentStatus: 'ok', llmStepCount: 2, spanId: `${LEFT_RUN_ID}-llm-1` })
    expect(body.right).toMatchObject({ runId: RIGHT_RUN_ID, contentStatus: 'ok', llmStepCount: 1 })
    expect(body.diff.systemPrompt.lines).toEqual([
      { op: 'removed', text: 'Be brief.' },
      { op: 'added', text: 'Be thorough.' },
    ])
    expect(body.diff.messages.changed).toBe(false)
    expect(readArtifactMock).toHaveBeenCalledWith(
      expect.anything(),
      { tenantId: TENANT, organizationId: ORG },
      ARTIFACT_REFS.llmRequest,
      LEFT_KEY,
    )
    expect(accessLog.log).toHaveBeenCalledTimes(2)
    expect(accessLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceKind: TRACE_CONTENT_ACCESS_RESOURCE_KIND,
        resourceId: RIGHT_RUN_ID,
        actorUserId: USER_ID,
        context: { kind: 'llm_request', key: RIGHT_KEY, apiKeyId: null },
      }),
    )
  })

  it('reports per-side statuses instead of failing the request', async () => {
    readArtifactMock.mockImplementation(async (_container, _scope, _ref, key) =>
      key === LEFT_KEY ? { status: 'missing' } : { status: 'unavailable' },
    )
    const { accessLog } = await setup()

    const res = await GET(makeRequest({ with: RIGHT_RUN_ID }), { params: Promise.resolve({ id: LEFT_RUN_ID }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.left.contentStatus).toBe('expired')
    expect(body.right.contentStatus).toBe('unavailable')
    expect(body.diff.systemPrompt).toBeUndefined()
    expect(body.diff.params).toHaveLength(1)
    expect(accessLog.log).not.toHaveBeenCalled()
  })

  it('marks a step without captured content or beyond the run as not_captured', async () => {
    await setup()

    const res = await GET(makeRequest({ with: RIGHT_RUN_ID, step: '1' }), {
      params: Promise.resolve({ id: LEFT_RUN_ID }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.left).toMatchObject({ contentStatus: 'not_captured', spanId: `${LEFT_RUN_ID}-llm-2` })
    expect(body.right).toMatchObject({ contentStatus: 'not_captured', spanId: null, metadata: null })
    expect(body.diff.params).toEqual([{ key: 'gen_ai.request.temperature', left: 0.2, right: null }])
    expect(readArtifactMock).not.toHaveBeenCalled()
  })

  it('treats a key older than the retention window as expired without reading it', async () => {
    await setup({ retentionDays: 0 })

    const res = await GET(makeRequest({ with: RIGHT_RUN_ID }), { params: Promise.resolve({ id: LEFT_RUN_ID }) })
    const body = await res.json()

    expect(body.left.contentStatus).toBe('expired')
    expect(body.right.contentStatus).toBe('expired')
    expect(readArtifactMock).not.toHaveBeenCalled()
  })
})
