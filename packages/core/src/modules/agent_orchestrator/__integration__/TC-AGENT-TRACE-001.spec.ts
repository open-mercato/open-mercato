import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { signTraceIngest, TRACE_INGEST_HEADERS } from '../lib/trace/ingestAuth'

/**
 * TC-AGENT-TRACE-001: Trace ingest → query → idempotency + HMAC gate.
 * Source: spec .ai/specs/agent-orchestrator/next/2026-06-19-agent-trace-eval-capture.md
 *
 * HMAC-signed ingest upserts a run with spans/tool-calls; re-ingesting the same
 * `(runtime, externalRunId)` is a no-op; the run is queryable with its trace
 * tree; a bad signature is rejected with 401.
 *
 * NOTE: signing reuses the per-tenant derived secret, so the test process and the
 * server MUST share `JWT_SECRET` (the integration harness boots the app with a
 * fixed test secret the test process inherits).
 */

const BASE_URL = process.env.BASE_URL?.trim() || ''
const resolveUrl = (path: string) => (BASE_URL ? `${BASE_URL}${path}` : path)

function decodeScope(token: string): { tenantId: string; organizationId: string } {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>
  const tenantId = (payload.tenantId ?? payload.tid) as string
  const organizationId = (payload.orgId ?? payload.organizationId ?? payload.oid) as string
  return { tenantId, organizationId }
}

function buildTracePayload(externalRunId: string) {
  const now = new Date().toISOString()
  return {
    runtime: 'integration-test',
    externalRunId,
    agentId: 'deals.health_check',
    status: 'ok' as const,
    output: { kind: 'informative', data: { ok: true } },
    spans: [
      {
        externalSpanId: 'root',
        sequence: 0,
        name: 'root',
        kind: 'system' as const,
        startedAt: now,
        toolCalls: [{ toolName: 'load_skill', status: 'ok' as const }],
      },
      {
        externalSpanId: 'child',
        parentExternalSpanId: 'root',
        sequence: 1,
        name: 'llm-call',
        kind: 'llm' as const,
        startedAt: now,
      },
    ],
  }
}

async function postTrace(
  request: APIRequestContext,
  scope: { tenantId: string; organizationId: string },
  body: unknown,
  opts: { tamper?: boolean } = {},
) {
  const raw = JSON.stringify(body)
  const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = signTraceIngest(scope.tenantId, msgId, timestamp, opts.tamper ? `${raw}tampered` : raw)
  return request.fetch(resolveUrl('/api/agent_orchestrator/trace/ingest'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [TRACE_INGEST_HEADERS.tenant]: scope.tenantId,
      [TRACE_INGEST_HEADERS.organization]: scope.organizationId,
      [TRACE_INGEST_HEADERS.id]: msgId,
      [TRACE_INGEST_HEADERS.timestamp]: timestamp,
      [TRACE_INGEST_HEADERS.signature]: signature,
    },
    data: raw,
  })
}

test.describe('TC-AGENT-TRACE-001: trace ingest, query, idempotency, HMAC gate', () => {
  test('ingests a run, exposes its trace, and is idempotent on re-ingest', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = decodeScope(token)
    const externalRunId = `it-${Date.now()}-${Math.random().toString(36).slice(2)}`

    // 1. First ingest creates the run + spans + tool-call.
    const first = await postTrace(request, scope, buildTracePayload(externalRunId))
    expect(first.status(), await first.text()).toBe(202)
    const firstBody = (await first.json()) as { created: boolean; spansAppended: number; toolCallsAppended: number; runId: string }
    expect(firstBody.created).toBe(true)
    expect(firstBody.spansAppended).toBe(2)
    expect(firstBody.toolCallsAppended).toBe(1)
    const runId = firstBody.runId

    // 2. Re-ingesting the identical trace is a no-op (idempotent on runtime+externalRunId).
    const second = await postTrace(request, scope, buildTracePayload(externalRunId))
    expect(second.status()).toBe(202)
    const secondBody = (await second.json()) as { created: boolean; spansAppended: number; toolCallsAppended: number }
    expect(secondBody.created).toBe(false)
    expect(secondBody.spansAppended).toBe(0)
    expect(secondBody.toolCallsAppended).toBe(0)

    // 3. The run is queryable in the list, scoped to the org.
    const list = await apiRequest(request, 'GET', '/api/agent_orchestrator/runs?window=24h&pageSize=100', { token })
    expect(list.status()).toBe(200)
    const listBody = (await list.json()) as { items?: Array<Record<string, unknown>> }
    const listed = (listBody.items ?? []).find((item) => item.external_run_id === externalRunId)
    expect(listed, 'ingested run should appear in the run list').toBeTruthy()

    // 4. The detail view returns the full trace tree with parent linkage.
    const detail = await apiRequest(request, 'GET', `/api/agent_orchestrator/runs/${runId}`, { token })
    expect(detail.status()).toBe(200)
    const detailBody = (await detail.json()) as {
      run: Record<string, unknown>
      spans: Array<Record<string, unknown>>
      toolCalls: Array<Record<string, unknown>>
    }
    expect(detailBody.spans).toHaveLength(2)
    expect(detailBody.toolCalls).toHaveLength(1)
    const root = detailBody.spans.find((s) => s.externalSpanId === 'root')!
    const child = detailBody.spans.find((s) => s.externalSpanId === 'child')!
    expect(child.parentSpanId).toBe(root.id)

    // 5. A tampered signature is rejected.
    const tampered = await postTrace(request, scope, buildTracePayload(`${externalRunId}-x`), { tamper: true })
    expect(tampered.status()).toBe(401)
  })

  test('rejects ingest with a missing signature', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = decodeScope(token)
    const raw = JSON.stringify(buildTracePayload(`it-nosig-${Date.now()}`))
    const response = await request.fetch(resolveUrl('/api/agent_orchestrator/trace/ingest'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [TRACE_INGEST_HEADERS.tenant]: scope.tenantId,
        [TRACE_INGEST_HEADERS.organization]: scope.organizationId,
      },
      data: raw,
    })
    expect(response.status()).toBe(401)
  })
})
