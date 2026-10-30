/** @jest-environment node */
import { GET, metadata } from '../api/runs/[id]/artifact/route'
import { ARTIFACT_REFS } from '../lib/trace/artifactStore'

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

const getArtifactMock = jest.fn<Promise<unknown>, unknown[]>()
jest.mock('../lib/trace/artifactStore', () => {
  const actual = jest.requireActual('../lib/trace/artifactStore')
  return { ...actual, getArtifact: (...args: unknown[]) => getArtifactMock(...args) }
})

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG = '44444444-4444-4444-8444-444444444444'
const RUN_ID = '33333333-3333-4333-8333-333333333333'
const RAW_KEY = 'agent-trace-artifacts/raw-output-key.json'

const RUN = { id: RUN_ID, tenantId: TENANT, organizationId: ORG, outputArtifactKey: null }
const CHECKS = [
  { id: 'check-schema', agentRunId: RUN_ID, kind: 'schema', evidence: null },
  {
    id: 'check-quote',
    agentRunId: RUN_ID,
    kind: 'evidence_quote',
    evidence: { ruleId: 'quotes', rawOutput: { key: RAW_KEY, status: 'stored' } },
  },
]

function makeRequest(key: string, kind = 'raw_output') {
  const query = new URLSearchParams({ key, kind })
  return new Request(`http://localhost/api/agent_orchestrator/runs/${RUN_ID}/artifact?${query.toString()}`)
}

const params = Promise.resolve({ id: RUN_ID })

async function setup(options: { run?: unknown; orgId?: string; checks?: unknown[] } = {}) {
  const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const { findWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user', tenantId: TENANT, orgId: options.orgId ?? ORG })
  ;(findWithDecryption as jest.Mock).mockResolvedValue(options.checks ?? CHECKS)
  const findOne = jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
    const run = options.run === undefined ? RUN : options.run
    if (!run) return null
    return where.organizationId === (run as { organizationId: string }).organizationId ? run : null
  })
  const em = { fork: () => ({ findOne }) }
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (token: string) => (token === 'em' ? em : null),
  })
  return { findWithDecryption: findWithDecryption as jest.Mock }
}

describe('GET /api/agent_orchestrator/runs/:id/artifact — kind=raw_output', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getArtifactMock.mockReset()
  })

  it('is guarded by trace.view like the other artifact kinds', () => {
    expect(metadata.GET.requireFeatures).toEqual(['agent_orchestrator.trace.view'])
  })

  it('returns the decrypted raw output when the key is referenced by a check row of the run', async () => {
    const rawObject = { kind: 'proposal', proposal: { evidence: [{ quote: 'free shipping forever' }] } }
    getArtifactMock.mockResolvedValue(rawObject)
    const { findWithDecryption } = await setup()

    const res = await GET(makeRequest(RAW_KEY), { params })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ key: RAW_KEY, kind: 'raw_output', payload: rawObject })
    const [, , where, , scope] = findWithDecryption.mock.calls[0]
    expect(where).toEqual({ agentRunId: RUN_ID, tenantId: TENANT, organizationId: ORG })
    expect(scope).toEqual({ tenantId: TENANT, organizationId: ORG })
    expect(getArtifactMock).toHaveBeenCalledWith(
      expect.anything(),
      { tenantId: TENANT, organizationId: ORG },
      ARTIFACT_REFS.runRawOutput,
      RAW_KEY,
    )
  })

  it('returns 404 for a key no check row of this run references', async () => {
    await setup()

    const res = await GET(makeRequest('agent-trace-artifacts/someone-else.json'), { params })

    expect(res.status).toBe(404)
    expect(getArtifactMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the run belongs to another organization', async () => {
    const { findWithDecryption } = await setup({ orgId: OTHER_ORG })

    const res = await GET(makeRequest(RAW_KEY), { params })

    expect(res.status).toBe(404)
    expect(findWithDecryption).not.toHaveBeenCalled()
    expect(getArtifactMock).not.toHaveBeenCalled()
  })

  it('returns 502 when the artifact store is unavailable', async () => {
    getArtifactMock.mockResolvedValue(null)
    await setup()

    const res = await GET(makeRequest(RAW_KEY), { params })

    expect(res.status).toBe(502)
  })

  it('rejects an unknown kind with 422', async () => {
    await setup()

    const res = await GET(makeRequest(RAW_KEY, 'raw'), { params })

    expect(res.status).toBe(422)
  })
})
