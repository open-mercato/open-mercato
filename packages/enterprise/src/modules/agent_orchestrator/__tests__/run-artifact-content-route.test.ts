/** @jest-environment node */
import { GET } from '../api/runs/[id]/artifact/route'
import { ARTIFACT_REFS, type ArtifactReadResult } from '../lib/trace/artifactStore'
import {
  TRACE_CONTENT_ACCESS_RESOURCE_KIND,
  isTraceContentKeyExpired,
  parseStorageKeyEpochMs,
} from '../lib/trace/contentArtifactAccess'
import { AgentContextBundle, AgentSpan, AgentToolCall } from '../data/entities'

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
const getArtifactMock = jest.fn<Promise<unknown>, unknown[]>()
jest.mock('../lib/trace/artifactStore', () => {
  const actual = jest.requireActual('../lib/trace/artifactStore')
  return {
    ...actual,
    readArtifact: (...args: unknown[]) => readArtifactMock(...args),
    getArtifact: (...args: unknown[]) => getArtifactMock(...args),
  }
})

const readPolicyMock = jest.fn()
jest.mock('../lib/trace/capturePolicy', () => {
  const actual = jest.requireActual('../lib/trace/capturePolicy')
  return { ...actual, readTraceCapturePolicy: (...args: unknown[]) => readPolicyMock(...args) }
})

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG = '44444444-4444-4444-8444-444444444444'
const RUN_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = '55555555-5555-4555-8555-555555555555'
const DAY_MS = 24 * 60 * 60 * 1000

function contentKey(name: string, ageDays = 1): string {
  const epochMs = Date.now() - ageDays * DAY_MS
  return `agent-trace-content/org_${ORG}/tenant_${TENANT}/${epochMs}_abcdef123456_${name}.json`
}

const REQUEST_KEY = contentKey('request')
const RESPONSE_KEY = contentKey('response')
const PAYLOAD_KEY = contentKey('payload')

const RUN = { id: RUN_ID, tenantId: TENANT, organizationId: ORG, outputArtifactKey: 'output-key' }
const SPANS = [
  { id: 'span-tool', kind: 'llm', attributes: { 'gen_ai.operation.name': 'chat' } },
  {
    id: 'span-llm',
    kind: 'llm',
    attributes: { 'om.content.request.key': REQUEST_KEY, 'om.content.response.key': RESPONSE_KEY },
  },
]
const BUNDLES = [{ id: 'bundle-1', payloadRef: PAYLOAD_KEY }]

type SetupOptions = {
  features?: string[]
  isSuperAdmin?: boolean
  orgId?: string
  retentionDays?: number
  accessLog?: { log: jest.Mock } | null
}

function makeRequest(key: string, kind: string) {
  const query = new URLSearchParams({ key, kind })
  return new Request(`http://localhost/api/agent_orchestrator/runs/${RUN_ID}/artifact?${query.toString()}`)
}

const params = Promise.resolve({ id: RUN_ID })

async function setup(options: SetupOptions = {}) {
  const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const { findWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: USER_ID, tenantId: TENANT, orgId: options.orgId ?? ORG })
  ;(findWithDecryption as jest.Mock).mockImplementation(
    async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (where.organizationId !== ORG || where.tenantId !== TENANT || where.agentRunId !== RUN_ID) return []
      if (entity === AgentSpan) return SPANS
      if (entity === AgentContextBundle) return BUNDLES.filter((bundle) => bundle.payloadRef === where.payloadRef)
      return []
    },
  )
  readPolicyMock.mockResolvedValue({
    policy: { retentionDays: options.retentionDays ?? 30 },
    source: 'tenant',
    updatedAt: null,
  })
  const findOne = jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === AgentToolCall) return null
    return where.organizationId === RUN.organizationId ? RUN : null
  })
  const em = { fork: () => ({ findOne }) }
  const loadAcl = jest.fn(async () => ({
    features: options.features ?? ['agent_orchestrator.trace.view', 'agent_orchestrator.trace.view_content'],
    isSuperAdmin: options.isSuperAdmin ?? false,
    organizations: null,
  }))
  const accessLog = options.accessLog === undefined ? { log: jest.fn(async () => null) } : options.accessLog
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (token: string) => {
      if (token === 'em') return em
      if (token === 'rbacService') return { loadAcl }
      if (token === 'accessLogService') {
        if (!accessLog) throw new Error('[internal] not registered')
        return accessLog
      }
      return null
    },
  })
  return { accessLog, loadAcl, findWithDecryption: findWithDecryption as jest.Mock }
}

describe('GET /api/agent_orchestrator/runs/:id/artifact — content kinds', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    readArtifactMock.mockReset()
    getArtifactMock.mockReset()
  })

  it('returns 403 for a content kind without trace.view_content', async () => {
    const { findWithDecryption } = await setup({ features: ['agent_orchestrator.trace.view'] })

    const res = await GET(makeRequest(REQUEST_KEY, 'llm_request'), { params })

    expect(res.status).toBe(403)
    expect(findWithDecryption).not.toHaveBeenCalled()
    expect(readArtifactMock).not.toHaveBeenCalled()
  })

  it('keeps the existing kinds on trace.view alone', async () => {
    getArtifactMock.mockResolvedValue({ result: 'ok' })
    const { loadAcl } = await setup({ features: ['agent_orchestrator.trace.view'] })

    const res = await GET(makeRequest('output-key', 'output'), { params })

    expect(res.status).toBe(200)
    expect(loadAcl).not.toHaveBeenCalled()
  })

  it('serves the llm request content and writes an access log', async () => {
    const payload = { schema: 'om.llm_request.v1', system: 'You are helpful.' }
    readArtifactMock.mockResolvedValue({ status: 'ok', value: payload })
    const { accessLog } = await setup()

    const res = await GET(makeRequest(REQUEST_KEY, 'llm_request'), { params })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ key: REQUEST_KEY, kind: 'llm_request', payload })
    expect(readArtifactMock).toHaveBeenCalledWith(
      expect.anything(),
      { tenantId: TENANT, organizationId: ORG },
      ARTIFACT_REFS.llmRequest,
      REQUEST_KEY,
    )
    expect(accessLog?.log).toHaveBeenCalledWith({
      tenantId: TENANT,
      organizationId: ORG,
      actorUserId: USER_ID,
      resourceKind: TRACE_CONTENT_ACCESS_RESOURCE_KIND,
      resourceId: RUN_ID,
      accessType: 'read:item',
      context: { kind: 'llm_request', key: REQUEST_KEY, apiKeyId: null },
    })
  })

  it('accepts the superadmin without an explicit view_content grant', async () => {
    readArtifactMock.mockResolvedValue({ status: 'ok', value: { content: 'hi' } })
    await setup({ features: [], isSuperAdmin: true })

    const res = await GET(makeRequest(RESPONSE_KEY, 'llm_response'), { params })

    expect(res.status).toBe(200)
    expect(readArtifactMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), ARTIFACT_REFS.llmResponse, RESPONSE_KEY)
  })

  it('serves the context payload referenced by the run bundle', async () => {
    readArtifactMock.mockResolvedValue({ status: 'ok', value: { records: [] } })
    await setup()

    const res = await GET(makeRequest(PAYLOAD_KEY, 'context_payload'), { params })

    expect(res.status).toBe(200)
    expect(readArtifactMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), ARTIFACT_REFS.contextPayload, PAYLOAD_KEY)
  })

  it('returns 404 for a key no span of this run references', async () => {
    await setup()

    const res = await GET(makeRequest(contentKey('foreign'), 'llm_request'), { params })

    expect(res.status).toBe(404)
    expect(readArtifactMock).not.toHaveBeenCalled()
  })

  it('returns 404 when a response key is requested as the request kind', async () => {
    await setup()

    const res = await GET(makeRequest(RESPONSE_KEY, 'llm_request'), { params })

    expect(res.status).toBe(404)
  })

  it('returns 404 for a payload key not on the run bundle', async () => {
    await setup()

    const res = await GET(makeRequest(REQUEST_KEY, 'context_payload'), { params })

    expect(res.status).toBe(404)
  })

  it('returns 404 when the run belongs to another organization', async () => {
    const { findWithDecryption } = await setup({ orgId: OTHER_ORG })

    const res = await GET(makeRequest(REQUEST_KEY, 'llm_request'), { params })

    expect(res.status).toBe(404)
    expect(findWithDecryption).not.toHaveBeenCalled()
    expect(readArtifactMock).not.toHaveBeenCalled()
  })

  it('returns 410 when the stored object is missing', async () => {
    readArtifactMock.mockResolvedValue({ status: 'missing' })
    const { accessLog } = await setup()

    const res = await GET(makeRequest(REQUEST_KEY, 'llm_request'), { params })

    expect(res.status).toBe(410)
    expect(accessLog?.log).not.toHaveBeenCalled()
  })

  it('returns 410 without reading when the key is older than the retention window', async () => {
    const expiredKey = contentKey('old', 3)
    BUNDLES.push({ id: 'bundle-old', payloadRef: expiredKey })
    try {
      await setup({ retentionDays: 1 })

      const res = await GET(makeRequest(expiredKey, 'context_payload'), { params })

      expect(res.status).toBe(410)
      expect(readArtifactMock).not.toHaveBeenCalled()
    } finally {
      BUNDLES.pop()
    }
  })

  it('returns 502 when storage is unavailable', async () => {
    readArtifactMock.mockResolvedValue({ status: 'unavailable' })
    await setup()

    const res = await GET(makeRequest(REQUEST_KEY, 'llm_request'), { params })

    expect(res.status).toBe(502)
  })

  it('still serves the content when the access log write fails', async () => {
    readArtifactMock.mockResolvedValue({ status: 'ok', value: { content: 'hi' } })
    const failing = { log: jest.fn(async () => Promise.reject(new Error('[internal] db down'))) }
    await setup({ accessLog: failing })

    const res = await GET(makeRequest(REQUEST_KEY, 'llm_request'), { params })

    expect(res.status).toBe(200)
    expect(failing.log).toHaveBeenCalled()
  })

  it('still serves the content when accessLogService is not registered', async () => {
    readArtifactMock.mockResolvedValue({ status: 'ok', value: { content: 'hi' } })
    await setup({ accessLog: null })

    const res = await GET(makeRequest(REQUEST_KEY, 'llm_request'), { params })

    expect(res.status).toBe(200)
  })
})

describe('trace content key retention helpers', () => {
  it('parses the epoch prefix of a storage key', () => {
    expect(parseStorageKeyEpochMs('prefix/agent-trace-content/org_a/tenant_b/1700000000000_abc_file.json')).toBe(
      1700000000000,
    )
    expect(parseStorageKeyEpochMs('agent-trace-content/org_a/tenant_b/file.json')).toBeNull()
  })

  it('treats a key older than the retention window as expired', () => {
    const now = new Date('2026-10-28T00:00:00.000Z')
    const tenDaysAgo = now.getTime() - 10 * DAY_MS
    const key = `agent-trace-content/org_a/tenant_b/${tenDaysAgo}_abc_file.json`
    expect(isTraceContentKeyExpired(key, 5, now)).toBe(true)
    expect(isTraceContentKeyExpired(key, 30, now)).toBe(false)
    expect(isTraceContentKeyExpired('agent-trace-content/no-epoch.json', 1, now)).toBe(false)
  })
})
