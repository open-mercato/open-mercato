import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteAgentRunsWithTraceByIds } from './helpers/agentPerfFixtures'
import {
  OTEL_DEPLOYMENT_DISABLED_REASON,
  OTEL_INGEST_SKIP_REASON,
  OTEL_RECEIVER_HOST,
  OTLP_PROTOBUF_CONTENT_TYPE,
  attributeString,
  eraseOtelIntegration,
  ingestSignedRun,
  postOtelTestSpan,
  readOtelIntegration,
  readOtelSettings,
  requestsForRun,
  restoreOtelSettings,
  saveOtelIntegrationCredentials,
  saveOtelSettings,
  setOtelIntegrationEnabled,
  spansOf,
  startFakeOtlpReceiver,
  type FakeOtlpReceiver,
} from './helpers/otelExportFixtures'

/**
 * TC-AGENT-OTEL-004: OTLP/HTTP protobuf delivery to an organization's own
 * collector (the `agent_orchestrator_otel_export` integration) and the SSRF
 * gate on tenant endpoints.
 *
 * - The organization's integration credentials point at a fake receiver on
 *   `127.0.0.1:4320` with `protocol: http/protobuf` and a custom header; the
 *   tenant settings select `destination: 'integration'`.
 * - While the integration is disabled the test span answers 200
 *   `{ ok: false, errorCode: 'integration_disabled' }`. Once enabled, the
 *   settings report `integration { configured: true, enabled: true }`, the test
 *   span arrives as `application/x-protobuf` carrying the header, and an
 *   HMAC-ingested run is exported there with an `invoke_agent` span (decoded by
 *   the fixtures' protobuf reader) — never to the deployment endpoint.
 * - Pointing the credentials at the metadata address
 *   `http://169.254.169.254/v1/traces` makes the test span answer
 *   `{ ok: false, errorCode: 'endpoint_blocked' }` without echoing the URL.
 *
 * The deployment can stay on OTLP/JSON: the protocol comes from the integration
 * credentials. Required env, in the app under test (and the same values in
 * the Playwright process, which also needs `JWT_SECRET` to sign ingests and
 * `DATABASE_URL` of the app's database to erase the integration rows):
 *
 *   OM_AGENT_OTEL_EXPORT=on \
 *   OM_AGENT_OTEL_EXPORT_ENDPOINT=http://127.0.0.1:4319/v1/traces \
 *   OM_AGENT_OTEL_EXPORT_DELAY_MS=0 \
 *   OM_AGENT_OTEL_EXPORT_TENANT_ENDPOINTS=allow \
 *   OM_AGENT_OTEL_EXPORT_PRIVATE_HOSTS=127.0.0.1 \
 *   yarn test:integration:ephemeral:start
 *
 * Skips with an explicit reason when the export is off, tenant endpoints are
 * denied, 127.0.0.1 is not an allowed private host, port 4320 is taken, the
 * organization already has its own export integration configured (the spec
 * never overwrites it), or the ingest signature is rejected. The tenant
 * settings are restored and the integration credentials, state and logs are
 * erased in `finally`.
 */

const TENANT_RECEIVER_PORT = 4320
const TENANT_ENDPOINT = `http://${OTEL_RECEIVER_HOST}:${TENANT_RECEIVER_PORT}/v1/traces`
const BLOCKED_ENDPOINT = 'http://169.254.169.254/v1/traces'
const TEST_HEADER_NAME = 'x-om-it-collector'
const AGENT_ID = 'it.otel_tenant'
const DELIVERY_TIMEOUT_MS = 30_000
const TENANT_ENDPOINTS_DENIED_REASON =
  'the app under test was not started with OM_AGENT_OTEL_EXPORT_TENANT_ENDPOINTS=allow'
const PRIVATE_HOST_REASON =
  'the app under test was not started with OM_AGENT_OTEL_EXPORT_PRIVATE_HOSTS=127.0.0.1, so the local receiver is blocked as a private address'
const TENANT_PORT_BUSY_REASON = `port ${TENANT_RECEIVER_PORT} is in use — the fake tenant collector cannot listen`
const EXISTING_INTEGRATION_REASON =
  'the organization already has agent_orchestrator_otel_export credentials; the spec does not overwrite a real collector'

function buildTenantTrace(externalRunId: string) {
  return {
    runtime: 'integration-test',
    externalRunId,
    agentId: AGENT_ID,
    status: 'ok' as const,
    spans: [
      {
        externalSpanId: 'llm-1',
        sequence: 0,
        name: 'chat gpt-4o-mini',
        kind: 'llm' as const,
        startedAt: new Date(Date.now() - 2_000).toISOString(),
        durationMs: 300,
        attributes: {
          'gen_ai.operation.name': 'chat',
          'gen_ai.provider.name': 'openai',
          'gen_ai.request.model': 'gpt-4o-mini',
          'gen_ai.usage.input_tokens': 21,
          'gen_ai.usage.output_tokens': 7,
        },
      },
    ],
  }
}

test.describe('TC-AGENT-OTEL-004: protobuf export to a tenant endpoint', () => {
  test('the integration destination receives protobuf and a metadata endpoint is blocked', async ({ request }) => {
    test.setTimeout(120_000)
    const adminToken = await getAuthToken(request, 'admin')
    const initial = await readOtelSettings(request, adminToken)
    test.skip(!initial.deployment?.enabled, OTEL_DEPLOYMENT_DISABLED_REASON)
    test.skip(!initial.deployment?.tenantEndpointsAllowed, TENANT_ENDPOINTS_DENIED_REASON)
    const existing = await readOtelIntegration(request, adminToken)
    test.skip(existing.hasCredentials === true, EXISTING_INTEGRATION_REASON)

    const receiver: FakeOtlpReceiver | null = await startFakeOtlpReceiver({ port: TENANT_RECEIVER_PORT })
    test.skip(!receiver, TENANT_PORT_BUSY_REASON)

    const runIds: string[] = []
    try {
      await saveOtelIntegrationCredentials(request, adminToken, {
        endpoint: TENANT_ENDPOINT,
        headers: `${TEST_HEADER_NAME}=otel-004`,
        protocol: 'http/protobuf',
      })
      const selectIntegration = await saveOtelSettings(
        request,
        adminToken,
        { enabled: true, content: 'none', exportUserIds: false, destination: 'integration' },
        initial.updatedAt,
      )
      expect(selectIntegration.status(), await selectIntegration.text()).toBe(200)

      const disabled = await postOtelTestSpan(request, adminToken)
      expect(disabled.status, disabled.raw).toBe(200)
      expect(disabled.body?.ok).toBe(false)
      expect(disabled.body?.errorCode).toBe('integration_disabled')
      expect(receiver!.requests).toHaveLength(0)

      await setOtelIntegrationEnabled(request, adminToken, true)
      const selected = await readOtelSettings(request, adminToken)
      expect(selected.settings?.destination).toBe('integration')
      expect(selected.integration).toEqual({ configured: true, enabled: true })
      expect(JSON.stringify(selected), 'the settings never echo the tenant endpoint').not.toContain(TENANT_ENDPOINT)

      const delivered = await postOtelTestSpan(request, adminToken)
      expect(delivered.status, delivered.raw).toBe(200)
      test.skip(delivered.body?.errorCode === 'endpoint_blocked', PRIVATE_HOST_REASON)
      expect(delivered.body?.ok, delivered.raw).toBe(true)
      expect(delivered.raw).not.toContain(TENANT_ENDPOINT)
      expect(receiver!.requests).toHaveLength(1)
      const testRequest = receiver!.requests[0]
      expect(testRequest.path).toBe('/v1/traces')
      expect(testRequest.contentType).toBe(OTLP_PROTOBUF_CONTENT_TYPE)
      expect(testRequest.contentEncoding).toBe('gzip')
      expect(testRequest.headers[TEST_HEADER_NAME]).toBe('otel-004')
      expect(spansOf(testRequest.body).map((span) => span.name)).toEqual(['om.export.test'])

      const runId = await ingestSignedRun(request, adminToken, buildTenantTrace(`it-otel-004-${randomUUID()}`))
      test.skip(runId === null, OTEL_INGEST_SKIP_REASON)
      runIds.push(runId!)
      await expect
        .poll(() => requestsForRun(receiver!.requests, runId!).length, {
          message: 'the export worker delivers the run to the tenant collector',
          timeout: DELIVERY_TIMEOUT_MS,
          intervals: [500, 1_000],
        })
        .toBeGreaterThan(0)
      const exported = requestsForRun(receiver!.requests, runId!)
      expect(exported).toHaveLength(1)
      expect(exported[0].contentType).toBe(OTLP_PROTOBUF_CONTENT_TYPE)
      const spans = spansOf(exported[0].body)
      const root = spans.find((span) => span.name === `invoke_agent ${AGENT_ID}`)
      expect(root, 'the protobuf export carries the invoke_agent span').toBeTruthy()
      expect(attributeString(root!.attributes, 'om.run.id')).toBe(runId)
      expect(root!.traceId).toMatch(/^[0-9a-f]{32}$/)
      const chat = spans.find((span) => span.name.startsWith('chat '))
      expect(chat?.parentSpanId).toBe(root!.spanId)

      await saveOtelIntegrationCredentials(request, adminToken, {
        endpoint: BLOCKED_ENDPOINT,
        protocol: 'http/protobuf',
      })
      const receivedBefore = receiver!.requests.length
      const blocked = await postOtelTestSpan(request, adminToken)
      expect(blocked.status, blocked.raw).toBe(200)
      expect(blocked.body?.ok).toBe(false)
      expect(blocked.body?.errorCode).toBe('endpoint_blocked')
      expect(blocked.raw, 'a blocked endpoint is never echoed').not.toContain('169.254')
      expect(receiver!.requests).toHaveLength(receivedBefore)
      const health = await readOtelSettings(request, adminToken)
      expect(health.health?.lastErrorCode).toBe('endpoint_blocked')
    } finally {
      await receiver?.close()
      await restoreOtelSettings(request, adminToken, initial.settings ?? null)
      await eraseOtelIntegration(request, adminToken)
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
    }
  })
})
