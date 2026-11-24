import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteAgentRunsWithTraceByIds } from './helpers/agentPerfFixtures'
import { signTraceIngest, TRACE_INGEST_HEADERS } from '../lib/trace/ingestAuth'

/**
 * TC-AGENT-TRACE-001: Trace ingest → query → idempotency + HMAC gate.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/next/2026-06-19-agent-trace-eval-capture.md
 *
 * HMAC-signed ingest upserts a run with spans/tool-calls; re-ingesting the same
 * `(runtime, externalRunId)` is a no-op; the run is queryable with its trace
 * tree; a bad signature is rejected with 401.
 *
 * NOTE: signing uses a key scoped to the tenant and organization, so the test process and the
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
    output: { kind: 'research', data: { ok: true } },
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
  const signature = signTraceIngest(scope.tenantId, scope.organizationId, msgId, timestamp, opts.tamper ? `${raw}tampered` : raw)
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

  test('accepts a linked trace only when its recorded step occurrence exists', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = decodeScope(token)
    const scope = { tenantId, organizationId }
    const workflowInstanceId = randomUUID()
    const stepId = 'review'
    const workflowId = `trace-test-${workflowInstanceId}`
    const currentAttemptId = randomUUID()
    const runs = [currentAttemptId, randomUUID()].map((invocationId) => ({
      id: randomUUID(),
      invocationId,
      payload: { ...buildTracePayload(randomUUID()), workflowInstanceId, stepId },
    }))
    const runIds = runs.map(({ id }) => id)
    const [current, stale] = runs

    try {
      await withClient(async (client) => {
        await client.query(
          `insert into workflow_instances (id, definition_id, workflow_id, version, status, current_step_id,
             context, started_at, tenant_id, organization_id, created_at, updated_at)
           values ($1, $2, $3, 1, 'RUNNING', $4, '{}', now(), $5, $6, now(), now())`,
          [workflowInstanceId, randomUUID(), workflowId, stepId, tenantId, organizationId],
        )
        await client.query(
          `insert into step_instances (id, workflow_instance_id, step_id, step_name, step_type, status,
             tenant_id, organization_id, created_at, updated_at)
           values ($1, $2, $3, 'Review', 'AUTOMATED', 'RUNNING', $4, $5, now(), now())`,
          [currentAttemptId, workflowInstanceId, stepId, tenantId, organizationId],
        )
        for (const { id, invocationId, payload } of runs) {
          await client.query(
            `insert into agent_runs (id, tenant_id, organization_id, workflow_instance_id, step_id, invocation_id,
               agent_id, runtime, external_run_id, input, created_at, updated_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}', now(), now())`,
            [id, tenantId, organizationId, workflowInstanceId, stepId, invocationId, payload.agentId,
              payload.runtime, payload.externalRunId],
          )
        }
      })

      const accepted = await postTrace(request, scope, current.payload)
      expect(accepted.status(), await accepted.text()).toBe(202)
      expect(await accepted.json()).toMatchObject({ runId: current.id, created: false, spansAppended: 2 })

      const rejected = await postTrace(request, scope, stale.payload)
      expect(rejected.status()).toBe(422)
      expect(await rejected.json()).toMatchObject({ code: 'workflow_instance_out_of_scope' })

      await withClient(async (client) => {
        const skipped = await client.query('select id from agent_spans where agent_run_id = $1', [stale.id])
        expect(skipped.rows).toHaveLength(0)
        const logs = await client.query(
          `select actor_user_id, tenant_id, organization_id, source_key, context_json, command_payload
             from action_logs where command_id = 'agent_orchestrator.trace.ingest' and resource_id = $1`,
          [current.id],
        )
        expect(logs.rows).toEqual([expect.objectContaining({
          actor_user_id: null,
          tenant_id: tenantId,
          organization_id: organizationId,
          source_key: 'api',
          context_json: expect.objectContaining({ systemActor: 'system:trace-ingest-webhook' }),
          command_payload: null,
        })])
      })
    } finally {
      await deleteAgentRunsWithTraceByIds(runIds)
      await withClient(async (client) => {
        await client.query('delete from action_logs where resource_id = any($1::text[])', [runIds])
        await client.query('delete from step_instances where id = $1', [currentAttemptId])
        await client.query('delete from workflow_instances where id = $1', [workflowInstanceId])
      })
    }
  })
})
