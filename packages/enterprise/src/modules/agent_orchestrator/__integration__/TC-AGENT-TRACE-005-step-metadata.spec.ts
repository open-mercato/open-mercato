import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { signTraceIngest, TRACE_INGEST_HEADERS } from '../lib/trace/ingestAuth'
import { deleteAgentRunsWithTraceByIds } from './helpers/agentPerfFixtures'
import { createScopedAgentUser, deleteScopedAgentUser, type ScopedAgentUser } from './helpers/agentAccessFixtures'
import {
  hasConfiguredLlmProvider,
  isModelUnavailableResponse,
  NO_LLM_PROVIDER_SKIP_REASON,
} from './helpers/llmProvider'

/**
 * TC-AGENT-TRACE-005: per-step model-call metadata and the trace capture policy.
 *
 * - The capture settings API round-trips a tenant level plus a time-boxed
 *   per-agent override, rejects a stale save with 409 (optimistic lock), an
 *   invalid body with 400, and a writer without `trace.view_content` with 403.
 *   The tenant's previous policy is written back in `finally`; when the tenant
 *   had none, that leaves a tenant row equal to the inherited default (there is
 *   no DELETE route).
 * - An HMAC-ingested run whose llm spans carry `gen_ai.*` / `om.*` keys is
 *   stored with the legacy keys backfilled and renders the "Model calls" card
 *   (parameters, "Provider default", per-step cost). Skipped when the test
 *   process cannot sign ingests for the app (different `JWT_SECRET`).
 * - A native run writes `gen_ai.*` keys on its llm spans; skipped without a
 *   configured LLM provider.
 *
 * Screenshots of the settings page and the trace card are attached as evidence.
 */

const integrationDirectory = path.dirname(fileURLToPath(import.meta.url))
const englishMessages = JSON.parse(
  readFileSync(path.join(integrationDirectory, '../i18n/en.json'), 'utf8'),
) as Record<string, string>

const SETTINGS_PATH = '/api/agent_orchestrator/trace-capture/settings'
const INGEST_PATH = '/api/agent_orchestrator/trace/ingest'
const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const OVERRIDE_AGENT_ID = 'deals.health_check'
const BASE_URL = process.env.BASE_URL?.trim() || ''
const INGEST_SKIP_REASON =
  'trace ingest rejected the signature — the test process does not share JWT_SECRET with the app under test'

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
  source?: 'tenant' | 'default'
  deploymentDefault?: CaptureLevel
  deploymentCeiling?: CaptureLevel
  updatedAt?: string | null
}
type SpanRow = { name?: string; kind?: string; attributes?: Record<string, unknown> | null }
type RunDetail = { spans?: SpanRow[] }
type AgentListItem = { id?: string; sampleInput?: unknown }

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

async function savePolicy(
  request: APIRequestContext,
  token: string,
  policy: CapturePolicy,
  updatedAt: string | null | undefined,
) {
  return apiRequest(request, 'PUT', SETTINGS_PATH, { token, data: policy, headers: lockHeaders(updatedAt) })
}

async function restorePolicy(request: APIRequestContext, token: string, previous: CapturePolicy | null) {
  if (!previous) return
  const current = await readSettings(request, token).catch(() => null)
  await savePolicy(request, token, previous, current?.updatedAt ?? null).catch(() => undefined)
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

function buildModelCallTrace(externalRunId: string) {
  const startedAt = new Date(Date.now() - 4_000).toISOString()
  const secondStartedAt = new Date(Date.now() - 2_000).toISOString()
  return {
    runtime: 'integration-test',
    externalRunId,
    agentId: OVERRIDE_AGENT_ID,
    status: 'ok' as const,
    output: { kind: 'research', data: { ok: true } },
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
          'gen_ai.request.temperature': 0.2,
          'gen_ai.request.max_tokens': '256',
          'gen_ai.usage.input_tokens': 120,
          'gen_ai.usage.output_tokens': 40,
          'gen_ai.response.finish_reasons': ['tool_calls'],
          'om.cost.micros': 1234,
          'om.cost.currency': 'USD',
          'om.capture.fidelity': 'reported',
        },
      },
      {
        externalSpanId: 'llm-2',
        sequence: 1,
        name: 'chat gpt-4o-mini',
        kind: 'llm' as const,
        startedAt: secondStartedAt,
        durationMs: 640,
        attributes: {
          'gen_ai.operation.name': 'chat',
          'gen_ai.provider.name': 'openai',
          'gen_ai.request.model': 'gpt-4o-mini',
          'gen_ai.usage.input_tokens': 180,
          'gen_ai.usage.output_tokens': 25,
          'gen_ai.response.finish_reasons': 'stop',
          'om.capture.fidelity': 'reported',
        },
      },
    ],
  }
}

test.describe('TC-AGENT-TRACE-005: step metadata and trace capture settings', () => {
  test('the capture settings API round-trips, locks, validates and gates writes', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const initial = await readSettings(request, adminToken)
    const previousPolicy = initial.policy ?? null
    let restricted: ScopedAgentUser | null = null

    try {
      const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      const firstPolicy: CapturePolicy = {
        level: 'off',
        evalLevel: 'metadata',
        perAgent: { [OVERRIDE_AGENT_ID]: { level: 'metadata', until } },
        retentionDays: 14,
        redactPii: true,
        includeProviderBody: false,
      }
      const firstSave = await savePolicy(request, adminToken, firstPolicy, initial.updatedAt)
      expect(firstSave.status(), await firstSave.text()).toBe(200)
      const firstSaved = await readJsonSafe<SettingsResponse>(firstSave)
      expect(firstSaved?.source).toBe('tenant')
      expect(typeof firstSaved?.updatedAt).toBe('string')

      const reread = await readSettings(request, adminToken)
      expect(reread.source).toBe('tenant')
      expect(reread.policy?.level).toBe('off')
      expect(reread.policy?.evalLevel).toBe('metadata')
      expect(reread.policy?.retentionDays).toBe(14)
      expect(reread.policy?.redactPii).toBe(true)
      expect(reread.policy?.perAgent[OVERRIDE_AGENT_ID]?.level).toBe('metadata')
      expect(Date.parse(reread.policy?.perAgent[OVERRIDE_AGENT_ID]?.until ?? '')).toBe(Date.parse(until))
      expect(['off', 'metadata', 'full']).toContain(reread.deploymentDefault)
      expect(['off', 'metadata', 'full']).toContain(reread.deploymentCeiling)

      const secondSave = await savePolicy(
        request,
        adminToken,
        { ...firstPolicy, level: 'metadata', perAgent: {} },
        reread.updatedAt,
      )
      expect(secondSave.status(), await secondSave.text()).toBe(200)

      const staleSave = await savePolicy(request, adminToken, { ...firstPolicy, level: 'full' }, firstSaved!.updatedAt)
      expect(staleSave.status(), 'a save carrying a superseded version is rejected').toBe(409)
      const afterStale = await readSettings(request, adminToken)
      expect(afterStale.policy?.level).toBe('metadata')
      expect(afterStale.policy?.perAgent).toEqual({})

      const invalidSave = await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token: adminToken,
        data: { level: 'everything', retentionDays: 0 },
        headers: lockHeaders(afterStale.updatedAt),
      })
      expect(invalidSave.status()).toBe(400)

      restricted = await createScopedAgentUser(request, adminToken, {
        label: 'trace-capture',
        features: ['agent_orchestrator.trace.view', 'agent_orchestrator.agents.manage'],
      })
      const restrictedRead = await apiRequest(request, 'GET', SETTINGS_PATH, { token: restricted.token })
      expect(restrictedRead.status()).toBe(200)
      const restrictedSave = await savePolicy(
        request,
        restricted.token,
        { ...firstPolicy, level: 'full' },
        afterStale.updatedAt,
      )
      expect(restrictedSave.status(), 'writing needs trace.view_content').toBe(403)

      await login(page, 'admin')
      await page.goto('/backend/settings/trace-capture', { waitUntil: 'domcontentloaded' })
      await expect(
        page.getByText(englishMessage('agent_orchestrator.settings.traceCapture.policy'), { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 })
      await expect(
        page.getByText(englishMessage('agent_orchestrator.settings.traceCapture.deployment'), { exact: true }).first(),
      ).toBeVisible()
      await test.info().attach('trace-capture-settings', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      })
    } finally {
      await deleteScopedAgentUser(request, adminToken, restricted).catch(() => undefined)
      await restorePolicy(request, adminToken, previousPolicy)
    }
  })

  test('an ingested run with gen_ai span keys renders the Model calls card', async ({ page, request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const runIds: string[] = []
    try {
      const ingest = await postSignedTrace(request, adminToken, buildModelCallTrace(`it-trace-005-${randomUUID()}`))
      test.skip(ingest.status() === 401, INGEST_SKIP_REASON)
      expect(ingest.status(), await ingest.text()).toBe(202)
      const ingested = await readJsonSafe<{ runId?: string; spansAppended?: number }>(ingest)
      expect(typeof ingested?.runId).toBe('string')
      expect(ingested?.spansAppended).toBe(2)
      const runId = ingested!.runId!
      runIds.push(runId)

      const detailRes = await apiRequest(request, 'GET', `/api/agent_orchestrator/runs/${runId}`, { token: adminToken })
      expect(detailRes.status()).toBe(200)
      const detail = await readJsonSafe<RunDetail>(detailRes)
      const llmSpans = (detail?.spans ?? []).filter((span) => span.kind === 'llm')
      expect(llmSpans).toHaveLength(2)
      const first = llmSpans.find((span) => span.attributes?.['gen_ai.request.temperature'] !== undefined)
      expect(first?.attributes?.['gen_ai.request.max_tokens'], 'numeric strings are coerced on ingest').toBe(256)
      expect(first?.attributes?.inputTokens, 'legacy keys are backfilled on ingest').toBe(120)
      expect(first?.attributes?.outputTokens).toBe(40)
      const second = llmSpans.find((span) => span !== first)
      expect(second?.attributes?.['gen_ai.response.finish_reasons']).toEqual(['stop'])
      expect(second?.attributes?.finishReason).toBe('stop')

      await login(page, 'admin')
      await page.goto(`/backend/traces/${runId}`, { waitUntil: 'domcontentloaded' })
      const card = page.getByTestId('llm-step-metadata-card')
      await expect(card).toBeVisible({ timeout: 15_000 })
      await expect(
        card.getByText(englishMessage('agent_orchestrator.trace.modelCalls'), { exact: true }),
      ).toBeVisible()
      const rows = card.getByTestId('llm-step-row')
      await expect(rows).toHaveCount(2)
      await expect(rows.nth(0)).toContainText('openai')
      await expect(rows.nth(0)).toContainText('gpt-4o-mini')
      await expect(rows.nth(0)).toContainText('temperature=0.2')
      await expect(rows.nth(0)).toContainText('max_tokens=256')
      await expect(rows.nth(0)).toContainText('0.001234 USD')
      await expect(rows.nth(0)).toContainText('tool_calls')
      await expect(rows.nth(0)).toContainText(englishMessage('agent_orchestrator.trace.fidelity.reported'))
      await expect(rows.nth(1)).toContainText(englishMessage('agent_orchestrator.trace.providerDefault'))
      await expect(rows.nth(1)).toContainText('stop')
      await card.scrollIntoViewIfNeeded()
      await test.info().attach('trace-model-calls-card', {
        body: await card.screenshot(),
        contentType: 'image/png',
      })
      await test.info().attach('trace-page', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      })
    } finally {
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
    }
  })

  test('a native run records gen_ai keys on its llm spans', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    test.skip(!(await hasConfiguredLlmProvider(request, adminToken)), NO_LLM_PROVIDER_SKIP_REASON)

    const agentsRes = await apiRequest(request, 'GET', '/api/agent_orchestrator/agents', { token: adminToken })
    expect(agentsRes.status(), await agentsRes.text()).toBe(200)
    const agentsBody = await readJsonSafe<{ items?: AgentListItem[] }>(agentsRes)
    const agent = (agentsBody?.items ?? []).find(
      (item) => typeof item.id === 'string' && item.sampleInput !== undefined,
    )
    expect(agent, 'a registered agent with a declared sampleInput is required').toBeTruthy()

    const initial = await readSettings(request, adminToken)
    const runIds: string[] = []
    try {
      const saved = await savePolicy(
        request,
        adminToken,
        { ...initial.policy!, level: 'metadata', perAgent: {} },
        initial.updatedAt,
      )
      expect(saved.status(), await saved.text()).toBe(200)

      const runRes = await apiRequest(
        request,
        'POST',
        `/api/agent_orchestrator/agents/${encodeURIComponent(agent!.id!)}/run`,
        { token: adminToken, data: { input: agent!.sampleInput } },
      )
      test.skip(isModelUnavailableResponse(runRes.status()), NO_LLM_PROVIDER_SKIP_REASON)
      expect(runRes.status(), await runRes.text()).toBe(200)
      const run = await readJsonSafe<{ runId?: string | null }>(runRes)
      expect(typeof run?.runId).toBe('string')
      runIds.push(run!.runId!)

      const detailRes = await apiRequest(request, 'GET', `/api/agent_orchestrator/runs/${run!.runId}`, {
        token: adminToken,
      })
      expect(detailRes.status()).toBe(200)
      const detail = await readJsonSafe<RunDetail>(detailRes)
      const llmSpans = (detail?.spans ?? []).filter((span) => span.kind === 'llm')
      expect(llmSpans.length).toBeGreaterThan(0)
      for (const span of llmSpans) {
        expect(typeof span.attributes?.['gen_ai.request.model']).toBe('string')
        expect(typeof span.attributes?.['gen_ai.provider.name']).toBe('string')
      }
      const manifest = (detail?.spans ?? []).find((span) => span.name === 'run.manifest')
      const capture = manifest?.attributes?.['om.capture'] as { level?: string } | undefined
      expect(capture?.level).toBe('metadata')
    } finally {
      await restorePolicy(request, adminToken, initial.policy ?? null)
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
    }
  })
})
