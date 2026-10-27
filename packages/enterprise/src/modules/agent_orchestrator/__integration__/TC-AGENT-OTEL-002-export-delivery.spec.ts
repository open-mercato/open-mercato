import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { signTraceIngest, TRACE_INGEST_HEADERS } from '../lib/trace/ingestAuth'
import { deleteAgentRunsWithTraceByIds } from './helpers/agentPerfFixtures'
import {
  OTEL_DEPLOYMENT_DISABLED_REASON,
  OTEL_RECEIVER_PORT_BUSY_REASON,
  attributeNumber,
  attributeString,
  collectKeyNames,
  englishMessage,
  readOtelSettings,
  restoreOtelSettings,
  saveOtelSettings,
  spansOf,
  startFakeOtlpReceiver,
  type FakeOtlpReceiver,
  type ReceivedOtlpRequest,
} from './helpers/otelExportFixtures'

/**
 * TC-AGENT-OTEL-002: an ingested agent run is exported to an OTLP receiver.
 *
 * Requires the app under test to run with `OM_AGENT_OTEL_EXPORT=on`,
 * `OM_AGENT_OTEL_EXPORT_ENDPOINT=http://127.0.0.1:4319/v1/traces`,
 * `OM_AGENT_OTEL_EXPORT_DELAY_MS=0` and a trace URL template
 * (`OM_AGENT_OTEL_TRACE_URL_TEMPLATE`); the capability is probed up front from
 * `GET /otel-export/settings` → `deployment.enabled`, and the case skips with
 * an explicit reason otherwise, when port 4319 is taken, or when the test
 * process cannot sign ingests for the app (different `JWT_SECRET`). Delivery
 * goes through the persistent subscriber and the export queue worker, which the
 * ephemeral runner spawns in-process (`AUTO_SPAWN_WORKERS=true`).
 *
 * With the tenant opted in, an HMAC-ingested run (an llm span with `gen_ai.*`
 * keys and a tool span) reaches the receiver as one request with the tenant
 * resource attributes, an `invoke_agent` root whose trace id matches
 * `GET /runs/:id` → `otel.traceId`, a `chat …` CLIENT child carrying
 * `gen_ai.usage.input_tokens` and an `execute_tool …` span; no key named
 * input/output/payload/evidence and none of the sentinel content placed in the
 * run input/output and tool summaries appears in the export. With the tenant
 * opted out, a second ingested run is not exported. The trace page shows the
 * "Open in tracing backend" link (screenshot attached).
 *
 * Each settings change is followed by a wait of the module-config cache TTL
 * (60 s) before the next ingest: the settings PUT refreshes the cache entry
 * under the request's tenant cache scope, while the export subscriber and
 * worker read it in the global cache scope, so they see the previous value
 * until that entry expires.
 *
 * The CLI backfill `--dry-run` is covered by the unit test
 * `__tests__/otel-export-cli.test.ts`: no integration spec shells out to the
 * `mercato` CLI, and the Playwright process has no module registry to run it in.
 */

const INGEST_PATH = '/api/agent_orchestrator/trace/ingest'
const BASE_URL = process.env.BASE_URL?.trim() || ''
const AGENT_ID = 'it.otel_export'
const DELIVERY_TIMEOUT_MS = 30_000
const OPT_OUT_WAIT_MS = 5_000
const MODULE_CONFIG_CACHE_TTL_MS = 60_000
const CONTENT_KEYS = new Set(['input', 'output', 'payload', 'evidence'])
const INGEST_SKIP_REASON =
  'trace ingest rejected the signature — the test process does not share JWT_SECRET with the app under test'
const SPAN_KIND_CLIENT = 3

type RunDetail = { otel?: { traceId?: string; url?: string } | null }

async function postSignedTrace(request: APIRequestContext, token: string, body: unknown) {
  const scope = getTokenScope(token)
  const raw = JSON.stringify(body)
  const messageId = `msg_${randomUUID()}`
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = signTraceIngest(scope.tenantId, messageId, timestamp, raw)
  return request.fetch(BASE_URL ? `${BASE_URL}${INGEST_PATH}` : INGEST_PATH, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [TRACE_INGEST_HEADERS.tenant]: scope.tenantId,
      [TRACE_INGEST_HEADERS.organization]: scope.organizationId,
      [TRACE_INGEST_HEADERS.id]: messageId,
      [TRACE_INGEST_HEADERS.timestamp]: timestamp,
      [TRACE_INGEST_HEADERS.signature]: signature,
    },
    data: raw,
  })
}

function buildExportTrace(externalRunId: string, sentinel: string) {
  const startedAt = new Date(Date.now() - 4_000).toISOString()
  const toolStartedAt = new Date(Date.now() - 2_000).toISOString()
  return {
    runtime: 'integration-test',
    externalRunId,
    agentId: AGENT_ID,
    status: 'ok' as const,
    input: { question: sentinel },
    output: { kind: 'research', data: { answer: sentinel } },
    spans: [
      {
        externalSpanId: 'llm-1',
        sequence: 0,
        name: 'chat gpt-4o-mini',
        kind: 'llm' as const,
        startedAt,
        durationMs: 812,
        attributes: {
          'gen_ai.operation.name': 'chat',
          'gen_ai.provider.name': 'openai',
          'gen_ai.request.model': 'gpt-4o-mini',
          'gen_ai.usage.input_tokens': 120,
          'gen_ai.usage.output_tokens': 40,
          'gen_ai.response.finish_reasons': ['tool_calls'],
        },
      },
      {
        externalSpanId: 'tool-1',
        sequence: 1,
        name: 'customers.search',
        kind: 'tool' as const,
        startedAt: toolStartedAt,
        durationMs: 120,
        toolCalls: [
          {
            toolName: 'customers.search',
            requestSummary: { query: sentinel },
            responseSummary: { hits: sentinel },
            status: 'ok' as const,
            latencyMs: 120,
          },
        ],
      },
    ],
  }
}

function requestsForRun(requests: ReceivedOtlpRequest[], runId: string): ReceivedOtlpRequest[] {
  return requests.filter((received) =>
    spansOf(received.body).some((span) => attributeString(span.attributes, 'om.run.id') === runId),
  )
}

async function ingestRun(request: APIRequestContext, token: string, sentinel: string): Promise<string | null> {
  const ingest = await postSignedTrace(request, token, buildExportTrace(`it-otel-002-${randomUUID()}`, sentinel))
  if (ingest.status() === 401) return null
  expect(ingest.status(), await ingest.text()).toBe(202)
  const ingested = await readJsonSafe<{ runId?: string }>(ingest)
  expect(typeof ingested?.runId).toBe('string')
  return ingested!.runId!
}

test.describe('TC-AGENT-OTEL-002: agent run export to an OTLP receiver', () => {
  test('an opted-in run is exported without content and an opted-out run is not', async ({ page, request }) => {
    test.setTimeout(240_000)
    const adminToken = await getAuthToken(request, 'admin')
    const initial = await readOtelSettings(request, adminToken)
    test.skip(!initial.deployment?.enabled, OTEL_DEPLOYMENT_DISABLED_REASON)

    const receiver: FakeOtlpReceiver | null = await startFakeOtlpReceiver()
    test.skip(!receiver, OTEL_RECEIVER_PORT_BUSY_REASON)

    const scope = getTokenScope(adminToken)
    const runIds: string[] = []
    const sentinel = `otel-sentinel-${randomUUID()}`
    try {
      const enable = await saveOtelSettings(
        request,
        adminToken,
        { enabled: true, content: 'none', exportUserIds: false },
        initial.updatedAt,
      )
      expect(enable.status(), await enable.text()).toBe(200)

      await page.waitForTimeout(MODULE_CONFIG_CACHE_TTL_MS + 2_000)
      const runId = await ingestRun(request, adminToken, sentinel)
      test.skip(runId === null, INGEST_SKIP_REASON)
      runIds.push(runId!)

      await expect
        .poll(() => requestsForRun(receiver!.requests, runId!).length, {
          message: 'the export worker delivers the run to the receiver',
          timeout: DELIVERY_TIMEOUT_MS,
          intervals: [500, 1_000],
        })
        .toBeGreaterThan(0)
      const delivered = requestsForRun(receiver!.requests, runId!)
      expect(delivered).toHaveLength(1)
      const exported = delivered[0]
      expect(exported.path).toBe('/v1/traces')
      expect(exported.contentEncoding).toBe('gzip')

      const resource = exported.body?.resourceSpans?.[0]?.resource
      expect(attributeString(resource?.attributes, 'om.tenant.id')).toBe(scope.tenantId)
      expect(attributeString(resource?.attributes, 'om.organization.id')).toBe(scope.organizationId)
      expect(attributeString(resource?.attributes, 'service.name')).toBeTruthy()

      const detailRes = await apiRequest(request, 'GET', `/api/agent_orchestrator/runs/${runId}`, { token: adminToken })
      expect(detailRes.status()).toBe(200)
      const detail = await readJsonSafe<RunDetail>(detailRes)
      const traceId = detail?.otel?.traceId
      expect(typeof traceId, 'the run detail carries the exported trace id').toBe('string')
      expect(detail?.otel?.url).toContain(traceId!)

      const spans = spansOf(exported.body)
      const root = spans.find((span) => span.name === `invoke_agent ${AGENT_ID}`)
      expect(root, 'one invoke_agent span per run').toBeTruthy()
      expect(spans.filter((span) => span.name.startsWith('invoke_agent'))).toHaveLength(1)
      expect(root!.traceId).toBe(traceId)
      expect(attributeString(root!.attributes, 'om.run.id')).toBe(runId)
      for (const span of spans) expect(span.traceId).toBe(traceId)

      const chat = spans.find((span) => span.name.startsWith('chat '))
      expect(chat, 'the llm span is exported as a chat span').toBeTruthy()
      expect(chat!.kind).toBe(SPAN_KIND_CLIENT)
      expect(chat!.parentSpanId).toBe(root!.spanId)
      expect(attributeNumber(chat!.attributes, 'gen_ai.usage.input_tokens')).toBe(120)
      expect(attributeNumber(chat!.attributes, 'gen_ai.usage.output_tokens')).toBe(40)

      const tool = spans.find((span) => span.name.startsWith('execute_tool '))
      expect(tool, 'the tool span is exported as an execute_tool span').toBeTruthy()
      expect(tool!.name).toBe('execute_tool customers.search')

      const keyNames = collectKeyNames(exported.body)
      const contentKeys = Array.from(keyNames).filter((name) =>
        name.split('.').some((segment) => CONTENT_KEYS.has(segment)),
      )
      expect(contentKeys, 'no content keys are exported').toEqual([])
      expect(exported.raw, 'no run or tool content is exported').not.toContain(sentinel)

      await login(page, 'admin')
      await page.goto(`/backend/traces/${runId}`, { waitUntil: 'domcontentloaded' })
      const link = page.getByTestId('otel-trace-link')
      await expect(link).toBeVisible({ timeout: 15_000 })
      await expect(link.getByText(traceId!, { exact: true })).toBeAttached()
      await expect(
        link.getByRole('link', { name: englishMessage('agent_orchestrator.traces.detail.otel.open') }),
      ).toHaveAttribute('href', detail!.otel!.url!)
      await test.info().attach('otel-trace-link', {
        body: await page.screenshot({ fullPage: false }),
        contentType: 'image/png',
      })

      const current = await readOtelSettings(request, adminToken)
      const disable = await saveOtelSettings(
        request,
        adminToken,
        { enabled: false, content: 'none', exportUserIds: false },
        current.updatedAt,
      )
      expect(disable.status(), await disable.text()).toBe(200)

      await page.waitForTimeout(MODULE_CONFIG_CACHE_TTL_MS + 2_000)
      const optedOutRunId = await ingestRun(request, adminToken, sentinel)
      expect(optedOutRunId).not.toBeNull()
      runIds.push(optedOutRunId!)
      await page.waitForTimeout(OPT_OUT_WAIT_MS)
      expect(requestsForRun(receiver!.requests, optedOutRunId!), 'an opted-out tenant exports nothing').toHaveLength(0)
    } finally {
      await receiver?.close()
      await restoreOtelSettings(request, adminToken, initial.settings ?? null)
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
    }
  })
})
