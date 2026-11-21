import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createScopedAgentUser, deleteScopedAgentUser, type ScopedAgentUser } from './helpers/agentAccessFixtures'
import { deleteAgentRunsWithTraceByIds } from './helpers/agentPerfFixtures'
import {
  OTEL_DEPLOYMENT_DISABLED_REASON,
  OTEL_INGEST_SKIP_REASON,
  OTEL_RECEIVER_PORT_BUSY_REASON,
  attributeString,
  ingestSignedRun,
  readOtelSettings,
  requestsForRun,
  restoreOtelSettings,
  saveOtelSettings,
  spanEvents,
  spansOf,
  startFakeOtlpReceiver,
  type FakeOtlpReceiver,
  type OtlpSpan,
  type ReceivedOtlpRequest,
} from './helpers/otelExportFixtures'

/**
 * TC-AGENT-OTEL-003: OTel content export (prompts and completions as GenAI
 * content attributes) behind its three locks.
 *
 * - Settings lock matrix (always runs): a writer holding `agents.manage` but
 *   not `trace.view_content` gets 403 for `content: 'full'`; an admin gets 422
 *   `content_export_not_allowed` while the deployment denies content, and 200
 *   once it allows it (`OM_AGENT_OTEL_EXPORT_CONTENT=allow`). Settings are
 *   restored in `finally`.
 * - Delivery (deployment-dependent): with the tenant at `content: 'full'` and
 *   the agent's trace capture at `full`, an HMAC-ingested run with a
 *   `manifest` (the run manifest span is what records `om.capture`; a run
 *   ingested without one never exports content) and an `llm` block reaches the receiver as a `chat` span carrying
 *   `om.content.export_status`. When trace content storage is available the
 *   status is `exported` and the span carries the
 *   `gen_ai.client.inference.operation.details` event with
 *   `gen_ai.input.messages`; without storage nothing was captured, so the
 *   status is `not_captured`/`unavailable`/`expired` and no content event or
 *   prompt text is exported. A forged `om.content.request.key` sent by the
 *   adapter is stripped at ingest and never appears in the export. A second
 *   run at capture `metadata` exports no content event and no
 *   `om.content.export_status`.
 *
 * Required env for the delivery case, in the app under test (and the same
 * values in the Playwright process, which also needs `JWT_SECRET` to sign
 * ingests and `DATABASE_URL` of the app's database for run cleanup):
 *
 *   OM_AGENT_OTEL_EXPORT=on \
 *   OM_AGENT_OTEL_EXPORT_ENDPOINT=http://127.0.0.1:4319/v1/traces \
 *   OM_AGENT_OTEL_EXPORT_DELAY_MS=0 \
 *   OM_AGENT_OTEL_EXPORT_CONTENT=allow \
 *   yarn test:integration:ephemeral:start
 *
 * The case skips with an explicit reason when the export is off, content is
 * denied by the deployment, the trace capture ceiling is below `full`, port
 * 4319 is taken, or the ingest signature is rejected.
 */

const CAPTURE_SETTINGS_PATH = '/api/agent_orchestrator/trace-capture/settings'
const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const AGENT_ID = 'it.otel_content'
const DELIVERY_TIMEOUT_MS = 30_000
const CONTENT_EVENT = 'gen_ai.client.inference.operation.details'
const EXPORT_STATUS_ATTRIBUTE = 'om.content.export_status'
const INPUT_MESSAGES_ATTRIBUTE = 'gen_ai.input.messages'
const NOT_EXPORTED_STATUSES = ['not_captured', 'unavailable', 'expired']
const CONTENT_DENIED_REASON =
  'the app under test was not started with OM_AGENT_OTEL_EXPORT_CONTENT=allow, so content export is denied by the deployment'
const CAPTURE_CEILING_REASON = 'the deployment trace capture ceiling (OM_AGENT_TRACE_CONTENT_MAX) is below full'

type CaptureLevel = 'off' | 'metadata' | 'full'
type CapturePolicy = {
  level: CaptureLevel
  evalLevel?: CaptureLevel
  perAgent: Record<string, { level: CaptureLevel; until?: string }>
  retentionDays: number
  redactPii: boolean
  includeProviderBody: boolean
}
type CaptureSettings = { policy?: CapturePolicy; deploymentCeiling?: CaptureLevel; updatedAt?: string | null }

function lockHeaders(updatedAt: string | null | undefined): Record<string, string> {
  return updatedAt ? { [OPTIMISTIC_LOCK_HEADER]: updatedAt } : {}
}

async function readCaptureSettings(request: APIRequestContext, token: string): Promise<CaptureSettings> {
  const response = await apiRequest(request, 'GET', CAPTURE_SETTINGS_PATH, { token })
  expect(response.status(), await response.text()).toBe(200)
  const body = await readJsonSafe<CaptureSettings>(response)
  expect(body?.policy, 'GET returns the resolved capture policy').toBeTruthy()
  return body!
}

async function setAgentCapture(request: APIRequestContext, token: string, level: CaptureLevel): Promise<void> {
  const current = await readCaptureSettings(request, token)
  const policy: CapturePolicy = {
    ...current.policy!,
    perAgent: { ...current.policy!.perAgent, [AGENT_ID]: { level } },
  }
  const response = await apiRequest(request, 'PUT', CAPTURE_SETTINGS_PATH, {
    token,
    data: policy,
    headers: lockHeaders(current.updatedAt),
  })
  expect(response.status(), await response.text()).toBe(200)
}

async function restoreCapturePolicy(
  request: APIRequestContext,
  token: string,
  previous: CapturePolicy | null,
): Promise<void> {
  if (!previous) return
  const current = await readCaptureSettings(request, token).catch(() => null)
  await apiRequest(request, 'PUT', CAPTURE_SETTINGS_PATH, {
    token,
    data: previous,
    headers: lockHeaders(current?.updatedAt ?? null),
  }).catch(() => undefined)
}

function buildContentTrace(externalRunId: string, prompt: string, forgedKey: string) {
  return {
    runtime: 'integration-test',
    externalRunId,
    agentId: AGENT_ID,
    status: 'ok' as const,
    manifest: { provider: 'openai', modelDeclared: 'gpt-4o-mini' },
    spans: [
      {
        externalSpanId: 'llm-1',
        sequence: 0,
        name: 'chat gpt-4o-mini',
        kind: 'llm' as const,
        startedAt: new Date(Date.now() - 3_000).toISOString(),
        durationMs: 640,
        attributes: { 'om.content.request.key': forgedKey },
        llm: {
          provider: 'openai',
          requestModel: 'gpt-4o-mini',
          usage: { inputTokens: 42, outputTokens: 12 },
          request: {
            system: 'You answer questions about integration test fixtures.',
            messages: [{ role: 'user', content: prompt }],
          },
          response: { finishReason: 'stop', content: [{ type: 'text', text: 'Acknowledged.' }] },
        },
      },
    ],
  }
}

function forgedContentKey(organizationId: string): string {
  return `agent-trace-content/${organizationId}/${Date.now()}_${randomBytes(4).toString('hex')}_llm-request.json`
}

async function awaitRunExport(receiver: FakeOtlpReceiver, runId: string): Promise<ReceivedOtlpRequest> {
  await expect
    .poll(() => requestsForRun(receiver.requests, runId).length, {
      message: 'the export worker delivers the run to the receiver',
      timeout: DELIVERY_TIMEOUT_MS,
      intervals: [500, 1_000],
    })
    .toBeGreaterThan(0)
  const delivered = requestsForRun(receiver.requests, runId)
  expect(delivered).toHaveLength(1)
  return delivered[0]
}

function chatSpanOf(exported: ReceivedOtlpRequest): OtlpSpan {
  const chat = spansOf(exported.body).find((span) => span.name.startsWith('chat '))
  expect(chat, 'the llm span is exported as a chat span').toBeTruthy()
  return chat!
}

test.describe('TC-AGENT-OTEL-003: OTel content export', () => {
  test('content export settings follow the deployment and view_content locks', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const initial = await readOtelSettings(request, adminToken)
    let writer: ScopedAgentUser | null = null

    try {
      writer = await createScopedAgentUser(request, adminToken, {
        label: 'otel-content',
        features: ['agent_orchestrator.agents.manage', 'agent_orchestrator.trace.view'],
      })
      const writerFull = await saveOtelSettings(
        request,
        writer.token,
        { enabled: true, content: 'full', exportUserIds: false },
        initial.updatedAt,
      )
      expect(writerFull.status(), 'content export needs trace.view_content').toBe(403)
      const writerNone = await saveOtelSettings(
        request,
        writer.token,
        { enabled: false, content: 'none', exportUserIds: false },
        initial.updatedAt,
      )
      expect(writerNone.status(), await writerNone.text()).toBe(200)

      const current = await readOtelSettings(request, adminToken)
      expect(current.settings?.content).toBe('none')
      const adminFull = await saveOtelSettings(
        request,
        adminToken,
        { enabled: true, content: 'full', exportUserIds: false },
        current.updatedAt,
      )
      if (current.deployment?.contentAllowed) {
        expect(adminFull.status(), await adminFull.text()).toBe(200)
        const optedIn = await readOtelSettings(request, adminToken)
        expect(optedIn.settings?.content).toBe('full')
      } else {
        expect(adminFull.status(), await adminFull.text()).toBe(422)
        const body = await readJsonSafe<{ error?: string }>(adminFull)
        expect(body?.error).toBe('content_export_not_allowed')
        const unchanged = await readOtelSettings(request, adminToken)
        expect(unchanged.settings?.content).toBe('none')
      }
    } finally {
      await deleteScopedAgentUser(request, adminToken, writer).catch(() => undefined)
      await restoreOtelSettings(request, adminToken, initial.settings ?? null)
    }
  })

  test('a full-capture run exports its content status and a metadata run exports no content', async ({ request }) => {
    test.setTimeout(120_000)
    const adminToken = await getAuthToken(request, 'admin')
    const initial = await readOtelSettings(request, adminToken)
    test.skip(!initial.deployment?.enabled, OTEL_DEPLOYMENT_DISABLED_REASON)
    test.skip(!initial.deployment?.contentAllowed, CONTENT_DENIED_REASON)
    const initialCapture = await readCaptureSettings(request, adminToken)
    test.skip(initialCapture.deploymentCeiling !== 'full', CAPTURE_CEILING_REASON)

    const receiver: FakeOtlpReceiver | null = await startFakeOtlpReceiver()
    test.skip(!receiver, OTEL_RECEIVER_PORT_BUSY_REASON)

    const runIds: string[] = []
    const prompt = `Summarize the marigold ledger ${randomUUID()}`
    const forgedKey = forgedContentKey(getTokenScope(adminToken).organizationId)
    try {
      const optIn = await saveOtelSettings(
        request,
        adminToken,
        { enabled: true, content: 'full', exportUserIds: false, destination: 'deployment' },
        initial.updatedAt,
      )
      expect(optIn.status(), await optIn.text()).toBe(200)
      await setAgentCapture(request, adminToken, 'full')

      const fullRunId = await ingestSignedRun(
        request,
        adminToken,
        buildContentTrace(`it-otel-003-full-${randomUUID()}`, prompt, forgedKey),
      )
      test.skip(fullRunId === null, OTEL_INGEST_SKIP_REASON)
      runIds.push(fullRunId!)

      const fullExport = await awaitRunExport(receiver!, fullRunId!)
      const fullChat = chatSpanOf(fullExport)
      const status = attributeString(fullChat.attributes, EXPORT_STATUS_ATTRIBUTE)
      expect(status, 'a full-mode chat span carries om.content.export_status').not.toBeNull()
      expect(fullExport.raw, 'a forged content key is stripped at ingest').not.toContain(forgedKey)
      const contentEvents = spanEvents(fullChat, CONTENT_EVENT)
      if (status === 'exported') {
        expect(contentEvents).toHaveLength(1)
        const inputMessages = attributeString(contentEvents[0].attributes, INPUT_MESSAGES_ATTRIBUTE)
        expect(inputMessages, 'the content event carries gen_ai.input.messages').not.toBeNull()
        expect(Array.isArray(JSON.parse(inputMessages!))).toBe(true)
      } else {
        expect(NOT_EXPORTED_STATUSES).toContain(status)
        expect(contentEvents, 'no content event without stored content').toHaveLength(0)
        expect(fullExport.raw, 'no prompt text is exported without stored content').not.toContain(prompt)
        test.info().annotations.push({
          type: 'note',
          description: `trace content storage did not provide the content (status ${status}); the exported-content path is covered by otel-export-job.test.ts`,
        })
      }

      await setAgentCapture(request, adminToken, 'metadata')
      const metadataRunId = await ingestSignedRun(
        request,
        adminToken,
        buildContentTrace(`it-otel-003-metadata-${randomUUID()}`, prompt, forgedKey),
      )
      expect(metadataRunId).not.toBeNull()
      runIds.push(metadataRunId!)

      const metadataExport = await awaitRunExport(receiver!, metadataRunId!)
      const metadataChat = chatSpanOf(metadataExport)
      expect(spanEvents(metadataChat, CONTENT_EVENT), 'a metadata run exports no content event').toHaveLength(0)
      expect(attributeString(metadataChat.attributes, EXPORT_STATUS_ATTRIBUTE)).toBeNull()
      expect(metadataExport.raw, 'a metadata run exports no prompt text').not.toContain(prompt)
      expect(metadataExport.raw).not.toContain(forgedKey)
    } finally {
      await receiver?.close()
      await restoreCapturePolicy(request, adminToken, initialCapture.policy ?? null)
      await restoreOtelSettings(request, adminToken, initial.settings ?? null)
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
    }
  })
})
