import {
  signTraceIngest,
  verifyTraceIngestRequest,
  TRACE_INGEST_HEADERS,
} from '../lib/trace/ingestAuth'

const TENANT = '11111111-1111-1111-1111-111111111111'
const ORG = '22222222-2222-2222-2222-222222222222'

function buildHeaders(opts: {
  tenantId?: string
  organizationId?: string
  msgId?: string
  timestamp?: string
  signature?: string
}): Headers {
  const headers = new Headers()
  if (opts.tenantId) headers.set(TRACE_INGEST_HEADERS.tenant, opts.tenantId)
  if (opts.organizationId) headers.set(TRACE_INGEST_HEADERS.organization, opts.organizationId)
  if (opts.msgId) headers.set(TRACE_INGEST_HEADERS.id, opts.msgId)
  if (opts.timestamp) headers.set(TRACE_INGEST_HEADERS.timestamp, opts.timestamp)
  if (opts.signature) headers.set(TRACE_INGEST_HEADERS.signature, opts.signature)
  return headers
}

function signedRequest(tenantId: string, organizationId: string, body: string) {
  const msgId = 'msg_1'
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = signTraceIngest(tenantId, msgId, timestamp, body)
  return { headers: buildHeaders({ tenantId, organizationId, msgId, timestamp, signature }), body }
}

describe('trace ingest HMAC auth', () => {
  const prevSecret = process.env.JWT_SECRET
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-for-trace-ingest'
  })
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = prevSecret
  })

  it('verifies a correctly signed request and returns the tenant/org scope', () => {
    const body = JSON.stringify({ runtime: 'in-process', externalRunId: 'r1', agentId: 'a' })
    const { headers } = signedRequest(TENANT, ORG, body)
    expect(verifyTraceIngestRequest(headers, body)).toEqual({ tenantId: TENANT, organizationId: ORG })
  })

  it('rejects a tampered body (signature no longer matches)', () => {
    const body = JSON.stringify({ runtime: 'in-process', externalRunId: 'r1', agentId: 'a' })
    const { headers } = signedRequest(TENANT, ORG, body)
    expect(verifyTraceIngestRequest(headers, body + 'tampered')).toBeNull()
  })

  it('rejects a signature made with another tenant secret (tenant isolation)', () => {
    const body = JSON.stringify({ runtime: 'in-process', externalRunId: 'r1', agentId: 'a' })
    const msgId = 'msg_1'
    const timestamp = String(Math.floor(Date.now() / 1000))
    // Signed for a DIFFERENT tenant, but headers claim TENANT.
    const signature = signTraceIngest('99999999-9999-9999-9999-999999999999', msgId, timestamp, body)
    const headers = buildHeaders({ tenantId: TENANT, organizationId: ORG, msgId, timestamp, signature })
    expect(verifyTraceIngestRequest(headers, body)).toBeNull()
  })

  it('rejects requests missing required headers', () => {
    const body = '{}'
    expect(verifyTraceIngestRequest(buildHeaders({ tenantId: TENANT }), body)).toBeNull()
  })

  it('rejects a stale timestamp outside the tolerance window', () => {
    const body = '{}'
    const msgId = 'msg_1'
    const staleTs = String(Math.floor(Date.now() / 1000) - 60 * 60)
    const signature = signTraceIngest(TENANT, msgId, staleTs, body)
    const headers = buildHeaders({ tenantId: TENANT, organizationId: ORG, msgId, timestamp: staleTs, signature })
    expect(verifyTraceIngestRequest(headers, body)).toBeNull()
  })
})
