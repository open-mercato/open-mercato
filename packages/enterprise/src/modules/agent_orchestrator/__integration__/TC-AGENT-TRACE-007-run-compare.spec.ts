import { expect, test, type APIRequestContext } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { signTraceIngest, TRACE_INGEST_HEADERS } from '../lib/trace/ingestAuth'
import { deleteAgentRunsWithTraceByIds, insertAgentRunFixtures } from './helpers/agentPerfFixtures'
import { createScopedAgentUser, deleteScopedAgentUser, type ScopedAgentUser } from './helpers/agentAccessFixtures'

/**
 * TC-AGENT-TRACE-007: run compare API, the trace Request/Response tabs and the
 * compare dialog.
 *
 * Two runs of one fixture agent are HMAC-ingested with `llm` request/response
 * bodies that differ only in one system-prompt line and the temperature. The
 * content cases raise the capture policy to `full` (stored content); every policy
 * change is restored in `finally`.
 *
 * - `GET /runs/:id/compare?with&step` with `trace.view` only: content is
 *   `forbidden`, both sides report `forbidden`, and only the manifest
 *   (`om.prompt.system.sha256`) and parameter diffs are returned. A run of
 *   another organization or an unknown id on either side → 404.
 * - As admin (`trace.view_content`): the system-prompt line diff shows the
 *   removed and the added line; the identical messages are unchanged.
 * - The trace page renders the stored request (system prompt) and response
 *   under the Request/Response tabs of the Model calls card, and the compare
 *   dialog defaults to the previous run of the agent and shows the same diff.
 * - At the `metadata` level both tabs report "Not captured" and the dialog
 *   shows the manifest and parameter diffs with the content-unavailable note
 *   (runs without content storage).
 *
 * Content cases skip when the test process cannot sign ingests (different
 * `JWT_SECRET`), when the deployment ceiling is below `full`, or when trace
 * content storage is unavailable.
 */

const integrationDirectory = path.dirname(fileURLToPath(import.meta.url))
const englishMessages = JSON.parse(
  readFileSync(path.join(integrationDirectory, '../i18n/en.json'), 'utf8'),
) as Record<string, string>

const SETTINGS_PATH = '/api/agent_orchestrator/trace-capture/settings'
const INGEST_PATH = '/api/agent_orchestrator/trace/ingest'
const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const CONTENT_STATUS_ATTRIBUTE = 'om.content.status'
const SYSTEM_PROMPT_SHA_KEY = 'om.prompt.system.sha256'
const TEMPERATURE_KEY = 'gen_ai.request.temperature'
const BASE_URL = process.env.BASE_URL?.trim() || ''
const INGEST_SKIP_REASON =
  'trace ingest rejected the signature — the test process does not share JWT_SECRET with the app under test'
const CEILING_SKIP_REASON = 'the deployment trace capture ceiling is below full'
const STORAGE_SKIP_REASON = 'trace content storage is unavailable in this environment'

const SHARED_PROMPT_LINE = 'You are the trace compare fixture agent.'
const BASELINE_LINE = 'Always answer in English.'
const CHANGED_LINE = 'Always answer in Polish.'
const CLOSING_LINE = 'Keep every answer short.'
const USER_MESSAGE = 'What is the refund policy?'

type CaptureLevel = 'off' | 'metadata' | 'full'
type CapturePolicy = {
  level: CaptureLevel
  evalLevel?: CaptureLevel
  perAgent: Record<string, { level: CaptureLevel; until?: string }>
  retentionDays: number
  redactPii: boolean
  includeProviderBody: boolean
}
type SettingsResponse = {
  policy?: CapturePolicy
  deploymentCeiling?: CaptureLevel
  updatedAt?: string | null
}
type FieldDiff = { key: string; left: unknown; right: unknown }
type TextDiff = { changed: boolean; truncated: boolean; lines: Array<{ op: string; text: string }> }
type JsonDiff = { changed: boolean; truncated: boolean; entries: unknown[] }
type CompareSide = { runId: string; contentStatus: string; llmStepCount: number }
type CompareResponse = {
  step: number
  content: 'included' | 'forbidden'
  left: CompareSide
  right: CompareSide
  diff: {
    manifest: FieldDiff[]
    params: FieldDiff[]
    systemPrompt?: TextDiff
    messages?: JsonDiff
    tools?: JsonDiff
  }
}
type SpanRow = { kind?: string; attributes?: Record<string, unknown> | null }
type RunDetail = { spans?: SpanRow[] }
type ComparePair = { baselineRunId: string; changedRunId: string; agentId: string }

function englishMessage(key: string): string {
  const message = englishMessages[key]
  if (!message) throw new Error(`[internal] en.json is missing "${key}"`)
  return message
}

function lockHeaders(updatedAt: string | null | undefined): Record<string, string> {
  return updatedAt ? { [OPTIMISTIC_LOCK_HEADER]: updatedAt } : {}
}

async function readSettings(request: APIRequestContext, token: string): Promise<SettingsResponse> {
  const response = await apiRequest(request, 'GET', SETTINGS_PATH, { token })
  expect(response.status(), await response.text()).toBe(200)
  const body = await readJsonSafe<SettingsResponse>(response)
  expect(body?.policy, 'GET returns the resolved policy').toBeTruthy()
  return body!
}

async function saveLevelPolicy(
  request: APIRequestContext,
  token: string,
  initial: SettingsResponse,
  level: CaptureLevel,
) {
  const response = await apiRequest(request, 'PUT', SETTINGS_PATH, {
    token,
    data: { ...initial.policy!, level, perAgent: {}, redactPii: false },
    headers: lockHeaders(initial.updatedAt),
  })
  expect(response.status(), await response.text()).toBe(200)
}

async function restorePolicy(request: APIRequestContext, token: string, previous: CapturePolicy | null) {
  if (!previous) return
  const current = await readSettings(request, token).catch(() => null)
  await apiRequest(request, 'PUT', SETTINGS_PATH, {
    token,
    data: previous,
    headers: lockHeaders(current?.updatedAt ?? null),
  }).catch(() => undefined)
}

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

function systemPrompt(variantLine: string): string {
  return [SHARED_PROMPT_LINE, variantLine, CLOSING_LINE].join('\n')
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function buildCompareTrace(agentId: string, variantLine: string, temperature: number, answer: string) {
  const prompt = systemPrompt(variantLine)
  return {
    runtime: 'integration-test',
    externalRunId: `it-trace-007-${randomUUID()}`,
    agentId,
    status: 'ok' as const,
    output: { answer },
    manifest: {
      systemPromptSha256: sha256Hex(prompt),
      modelResolved: 'gpt-4o-mini',
      provider: 'openai',
    },
    spans: [
      {
        externalSpanId: 'llm-1',
        sequence: 0,
        name: 'chat gpt-4o-mini',
        kind: 'llm' as const,
        startedAt: new Date(Date.now() - 2_000).toISOString(),
        durationMs: 640,
        llm: {
          provider: 'openai',
          requestModel: 'gpt-4o-mini',
          params: { temperature },
          usage: { inputTokens: 120, outputTokens: 24 },
          request: {
            system: prompt,
            messages: [{ role: 'user', content: [{ type: 'text', text: USER_MESSAGE }] }],
          },
          response: {
            finishReason: 'stop',
            content: [{ type: 'text', text: answer }],
          },
        },
      },
    ],
  }
}

async function ingestRun(request: APIRequestContext, token: string, body: unknown): Promise<string | null> {
  const response = await postSignedTrace(request, token, body)
  if (response.status() === 401) return null
  expect(response.status(), await response.text()).toBe(202)
  const ingested = await readJsonSafe<{ runId?: string }>(response)
  expect(typeof ingested?.runId).toBe('string')
  return ingested!.runId!
}

async function ingestComparePair(
  request: APIRequestContext,
  token: string,
  runIds: string[],
  answers: { baseline: string; changed: string },
): Promise<ComparePair | null> {
  const agentId = `it_trace_compare.agent_${randomUUID().slice(0, 8)}`
  const baselineRunId = await ingestRun(request, token, buildCompareTrace(agentId, BASELINE_LINE, 0.2, answers.baseline))
  if (!baselineRunId) return null
  runIds.push(baselineRunId)
  const changedRunId = await ingestRun(request, token, buildCompareTrace(agentId, CHANGED_LINE, 0.7, answers.changed))
  if (!changedRunId) return null
  runIds.push(changedRunId)
  return { baselineRunId, changedRunId, agentId }
}

function comparePath(runId: string, withRunId: string, step = 0): string {
  return `/api/agent_orchestrator/runs/${runId}/compare?with=${withRunId}&step=${step}`
}

async function readCompare(request: APIRequestContext, token: string, pair: ComparePair): Promise<CompareResponse> {
  const response = await apiRequest(request, 'GET', comparePath(pair.changedRunId, pair.baselineRunId), { token })
  expect(response.status(), await response.text()).toBe(200)
  return (await readJsonSafe<CompareResponse>(response))!
}

async function readLlmContentStatus(
  request: APIRequestContext,
  token: string,
  runId: string,
): Promise<string | null> {
  const response = await apiRequest(request, 'GET', `/api/agent_orchestrator/runs/${runId}`, { token })
  expect(response.status()).toBe(200)
  const detail = await readJsonSafe<RunDetail>(response)
  const llmSpan = (detail?.spans ?? []).find((span) => span.kind === 'llm')
  const status = llmSpan?.attributes?.[CONTENT_STATUS_ATTRIBUTE]
  return typeof status === 'string' ? status : null
}

function linesWithOp(diff: TextDiff | undefined, op: string): string[] {
  return (diff?.lines ?? []).filter((line) => line.op === op).map((line) => line.text)
}

test.describe('TC-AGENT-TRACE-007: run compare and trace content tabs', () => {
  test('compare returns only the metadata diff without view_content and 404s out of scope', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenScope(adminToken)
    const runIds: string[] = []
    let restricted: ScopedAgentUser | null = null
    try {
      const pair = await ingestComparePair(request, adminToken, runIds, {
        baseline: `Baseline answer ${randomUUID()}`,
        changed: `Changed answer ${randomUUID()}`,
      })
      test.skip(!pair, INGEST_SKIP_REASON)

      restricted = await createScopedAgentUser(request, adminToken, {
        label: 'trace-compare',
        features: ['agent_orchestrator.trace.view'],
      })
      const compare = await readCompare(request, restricted.token, pair!)
      expect(compare.step).toBe(0)
      expect(compare.content, 'content needs trace.view_content').toBe('forbidden')
      expect(compare.left.runId).toBe(pair!.changedRunId)
      expect(compare.right.runId).toBe(pair!.baselineRunId)
      expect(compare.left.contentStatus).toBe('forbidden')
      expect(compare.right.contentStatus).toBe('forbidden')
      expect(compare.left.llmStepCount).toBe(1)
      expect(compare.diff.systemPrompt, 'no system-prompt content without view_content').toBeUndefined()
      expect(compare.diff.messages).toBeUndefined()
      expect(compare.diff.tools).toBeUndefined()
      const manifestKeys = compare.diff.manifest.map((entry) => entry.key)
      expect(manifestKeys, 'the system-prompt hash differs in the manifest').toContain(SYSTEM_PROMPT_SHA_KEY)
      const temperature = compare.diff.params.find((entry) => entry.key === TEMPERATURE_KEY)
      expect(temperature).toEqual({ key: TEMPERATURE_KEY, left: 0.7, right: 0.2 })

      const [foreignRunId] = await insertAgentRunFixtures([
        { tenantId, organizationId: randomUUID(), agentId: pair!.agentId, status: 'ok', createdAt: new Date() },
      ])
      runIds.push(foreignRunId)
      const foreignTarget = await apiRequest(request, 'GET', comparePath(pair!.changedRunId, foreignRunId), {
        token: adminToken,
      })
      expect(foreignTarget.status(), "another organization's run is not comparable").toBe(404)
      const foreignSubject = await apiRequest(request, 'GET', comparePath(foreignRunId, pair!.changedRunId), {
        token: adminToken,
      })
      expect(foreignSubject.status()).toBe(404)
      const unknownTarget = await apiRequest(request, 'GET', comparePath(pair!.changedRunId, randomUUID()), {
        token: adminToken,
      })
      expect(unknownTarget.status()).toBe(404)
      const invalidQuery = await apiRequest(
        request,
        'GET',
        `/api/agent_orchestrator/runs/${pair!.changedRunId}/compare?with=not-a-uuid`,
        { token: adminToken },
      )
      expect(invalidQuery.status()).toBe(422)
    } finally {
      await deleteScopedAgentUser(request, adminToken, restricted).catch(() => undefined)
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
    }
  })

  test('compare with view_content shows the changed system-prompt line', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const initial = await readSettings(request, adminToken)
    test.skip(initial.deploymentCeiling !== 'full', CEILING_SKIP_REASON)
    const runIds: string[] = []
    try {
      await saveLevelPolicy(request, adminToken, initial, 'full')
      const pair = await ingestComparePair(request, adminToken, runIds, {
        baseline: `Baseline answer ${randomUUID()}`,
        changed: `Changed answer ${randomUUID()}`,
      })
      test.skip(!pair, INGEST_SKIP_REASON)
      const contentStatus = await readLlmContentStatus(request, adminToken, pair!.changedRunId)
      test.skip(contentStatus !== 'stored', STORAGE_SKIP_REASON)

      const compare = await readCompare(request, adminToken, pair!)
      test.skip(compare.left.contentStatus === 'unavailable', STORAGE_SKIP_REASON)
      expect(compare.content).toBe('included')
      expect(compare.left.contentStatus).toBe('ok')
      expect(compare.right.contentStatus).toBe('ok')
      expect(compare.diff.systemPrompt?.changed).toBe(true)
      expect(compare.diff.systemPrompt?.truncated).toBe(false)
      expect(linesWithOp(compare.diff.systemPrompt, 'removed')).toEqual([CHANGED_LINE])
      expect(linesWithOp(compare.diff.systemPrompt, 'added')).toEqual([BASELINE_LINE])
      expect(linesWithOp(compare.diff.systemPrompt, 'equal')).toEqual([SHARED_PROMPT_LINE, CLOSING_LINE])
      expect(compare.diff.messages?.changed, 'identical messages are not reported').toBe(false)
      expect(compare.diff.manifest.map((entry) => entry.key)).toContain(SYSTEM_PROMPT_SHA_KEY)
    } finally {
      await restorePolicy(request, adminToken, initial.policy ?? null)
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
    }
  })

  test('the trace page shows the Request/Response tabs and the compare dialog diff', async ({ page, request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const initial = await readSettings(request, adminToken)
    test.skip(initial.deploymentCeiling !== 'full', CEILING_SKIP_REASON)
    const runIds: string[] = []
    const changedAnswer = `Changed answer ${randomUUID()}`
    try {
      await saveLevelPolicy(request, adminToken, initial, 'full')
      const pair = await ingestComparePair(request, adminToken, runIds, {
        baseline: `Baseline answer ${randomUUID()}`,
        changed: changedAnswer,
      })
      test.skip(!pair, INGEST_SKIP_REASON)
      const contentStatus = await readLlmContentStatus(request, adminToken, pair!.changedRunId)
      test.skip(contentStatus !== 'stored', STORAGE_SKIP_REASON)

      await login(page, 'admin')
      await page.goto(`/backend/traces/${pair!.changedRunId}`, { waitUntil: 'domcontentloaded' })
      const card = page.getByTestId('llm-step-metadata-card')
      await expect(card).toBeVisible({ timeout: 15_000 })
      const row = card.getByTestId('llm-step-row')
      await expect(row).toHaveCount(1)
      await row.getByRole('button').first().click()

      const panels = card.getByTestId('llm-step-panels')
      await expect(panels).toBeVisible({ timeout: 15_000 })
      await expect(
        panels.getByRole('tab', { name: englishMessage('agent_orchestrator.trace.request'), exact: true }),
      ).toBeVisible()
      const requestView = panels.getByTestId('llm-request-view')
      await expect(requestView).toBeVisible({ timeout: 15_000 })
      await expect(requestView).toContainText(englishMessage('agent_orchestrator.trace.systemPrompt'))
      await expect(requestView).toContainText(CHANGED_LINE)
      await expect(requestView).toContainText(USER_MESSAGE)
      await test.info().attach('trace-request-tab', { body: await card.screenshot(), contentType: 'image/png' })

      await panels.getByRole('tab', { name: englishMessage('agent_orchestrator.trace.response'), exact: true }).click()
      const responseView = panels.getByTestId('llm-response-view')
      await expect(responseView).toBeVisible({ timeout: 15_000 })
      await expect(responseView).toContainText(changedAnswer)
      await expect(responseView).toContainText('stop')
      await test.info().attach('trace-response-tab', { body: await card.screenshot(), contentType: 'image/png' })

      await page.getByTestId('run-compare-open').click()
      const dialog = page.getByTestId('run-compare-dialog')
      await expect(dialog).toBeVisible({ timeout: 15_000 })
      await expect(
        dialog.getByText(englishMessage('agent_orchestrator.trace.compare.title'), { exact: true }),
      ).toBeVisible()
      await expect(dialog.getByTestId(`compare-side-${pair!.baselineRunId}`)).toBeVisible({ timeout: 15_000 })
      const promptDiff = dialog.getByTestId('compare-system-prompt')
      await expect(promptDiff).toBeVisible()
      await expect(promptDiff.locator('[data-op="removed"]')).toContainText(CHANGED_LINE)
      await expect(promptDiff.locator('[data-op="added"]')).toContainText(BASELINE_LINE)
      await expect(dialog.getByTestId('compare-params')).toContainText(TEMPERATURE_KEY)
      await expect(dialog.getByTestId('compare-manifest')).toContainText(SYSTEM_PROMPT_SHA_KEY)
      await test.info().attach('trace-compare-dialog', { body: await dialog.screenshot(), contentType: 'image/png' })

      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    } finally {
      await restorePolicy(request, adminToken, initial.policy ?? null)
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
    }
  })
  test('at the metadata level the tabs report not captured and the dialog diffs metadata only', async ({
    page,
    request,
  }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const initial = await readSettings(request, adminToken)
    const runIds: string[] = []
    try {
      await saveLevelPolicy(request, adminToken, initial, 'metadata')
      const pair = await ingestComparePair(request, adminToken, runIds, {
        baseline: `Baseline answer ${randomUUID()}`,
        changed: `Changed answer ${randomUUID()}`,
      })
      test.skip(!pair, INGEST_SKIP_REASON)
      expect(await readLlmContentStatus(request, adminToken, pair!.changedRunId)).toBe('disabled')

      await login(page, 'admin')
      await page.goto(`/backend/traces/${pair!.changedRunId}`, { waitUntil: 'domcontentloaded' })
      const card = page.getByTestId('llm-step-metadata-card')
      await expect(card).toBeVisible({ timeout: 15_000 })
      await card.getByTestId('llm-step-row').first().getByRole('button').first().click()
      const panels = card.getByTestId('llm-step-panels')
      await expect(panels).toBeVisible({ timeout: 15_000 })
      const notCaptured = englishMessage('agent_orchestrator.trace.contentNotCaptured')
      await expect(panels.getByTestId('llm-content-not-captured').first()).toContainText(notCaptured)
      await panels.getByRole('tab', { name: englishMessage('agent_orchestrator.trace.response'), exact: true }).click()
      await expect(panels.getByTestId('llm-content-not-captured').last()).toBeVisible()
      await expect(panels.getByTestId('llm-request-view')).toHaveCount(0)
      await test.info().attach('trace-tabs-not-captured', { body: await card.screenshot(), contentType: 'image/png' })

      await page.getByTestId('run-compare-open').click()
      const dialog = page.getByTestId('run-compare-dialog')
      await expect(dialog).toBeVisible({ timeout: 15_000 })
      await expect(dialog.getByTestId(`compare-side-${pair!.baselineRunId}`)).toBeVisible({ timeout: 15_000 })
      await expect(dialog.getByTestId('compare-params')).toContainText(TEMPERATURE_KEY)
      await expect(dialog.getByTestId('compare-manifest')).toContainText(SYSTEM_PROMPT_SHA_KEY)
      await expect(dialog.getByTestId('compare-content-unavailable')).toContainText(
        englishMessage('agent_orchestrator.trace.compare.contentUnavailable'),
      )
      await expect(dialog.getByTestId('compare-system-prompt')).toHaveCount(0)
      await test.info().attach('trace-compare-metadata-only', { body: await dialog.screenshot(), contentType: 'image/png' })

      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    } finally {
      await restorePolicy(request, adminToken, initial.policy ?? null)
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
    }
  })
})
