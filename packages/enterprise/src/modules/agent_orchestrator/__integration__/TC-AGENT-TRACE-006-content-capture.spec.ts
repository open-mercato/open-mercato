import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteAgentRunsWithTraceByIds, insertAgentRunFixtures } from './helpers/agentPerfFixtures'
import { createScopedAgentUser, deleteScopedAgentUser, type ScopedAgentUser } from './helpers/agentAccessFixtures'
import {
  hasConfiguredLlmProvider,
  isModelUnavailableResponse,
  NO_LLM_PROVIDER_SKIP_REASON,
} from './helpers/llmProvider'

/**
 * TC-AGENT-TRACE-006: full-fidelity content capture and the content artifact route.
 *
 * - Runs and `llm` spans are seeded directly (no storage needed): the span
 *   carries `om.content.request.key` with a fake `agent-trace-content` key.
 * - `kind=llm_request` without `agent_orchestrator.trace.view_content` → 403,
 *   even for a key the run owns.
 * - As admin: a key not referenced by any span of the run → 404; another
 *   organization's run → 404; a key whose `<epochMs>` prefix is older than the
 *   tenant `retentionDays` → 410 (policy set through the capture settings API
 *   and restored in `finally`); a fresh fake key is never served (410 when the
 *   object is missing, 502 when storage is unavailable).
 * - A native run at the `full` level with a tenant prompt override stores a
 *   request artifact that decrypts to a system prompt containing the override.
 *   Skipped without an LLM provider, when the deployment ceiling is below
 *   `full`, or when trace storage is unavailable.
 */

const SETTINGS_PATH = '/api/agent_orchestrator/trace-capture/settings'
const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const CONTENT_REQUEST_KEY_ATTRIBUTE = 'om.content.request.key'
const CONTENT_STATUS_ATTRIBUTE = 'om.content.status'
const LLM_REQUEST_SCHEMA = 'om.llm_request.v1'
const SEED_AGENT_ID = 'deals.health_check'
const DAY_MS = 24 * 60 * 60 * 1000
const OVERRIDE_MARKER = `Trace content capture marker ${randomUUID()}.`
const STORAGE_SKIP_REASON = 'trace content storage is unavailable in this environment'
const CEILING_SKIP_REASON = 'the deployment trace capture ceiling is below full'

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
type SpanRow = { name?: string; kind?: string; attributes?: Record<string, unknown> | null }
type RunDetail = { spans?: SpanRow[] }
type AgentListItem = { id?: string; sampleInput?: unknown }
type PromptOverrideState = { override?: { sections?: Record<string, string> } | null }
type ArtifactResponse = { kind?: string; payload?: { schema?: string; system?: unknown } }

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
  const response = await apiRequest(request, 'PUT', SETTINGS_PATH, {
    token,
    data: policy,
    headers: lockHeaders(updatedAt),
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

function fakeContentKey(organizationId: string, uploadedAt: Date): string {
  return `agent-trace-content/${organizationId}/${uploadedAt.getTime()}_${randomBytes(4).toString('hex')}_llm-request.json`
}

async function insertLlmSpanWithContentKey(input: {
  tenantId: string
  organizationId: string
  runId: string
  requestKey: string
}): Promise<void> {
  const startedAt = new Date(Date.now() - 2_000)
  await withClient(async (client) => {
    await client.query(
      `insert into agent_spans (id, tenant_id, organization_id, agent_run_id, external_span_id, sequence, name, kind, started_at, duration_ms, status, attributes, created_at)
       values ($1, $2, $3, $4, $5, 0, $6, 'llm', $7, 500, 'ok', $8::jsonb, $7)`,
      [
        randomUUID(),
        input.tenantId,
        input.organizationId,
        input.runId,
        `it-trace-006-${randomUUID()}`,
        'chat gpt-4o-mini',
        startedAt,
        JSON.stringify({
          'gen_ai.operation.name': 'chat',
          'gen_ai.provider.name': 'openai',
          'gen_ai.request.model': 'gpt-4o-mini',
          [CONTENT_REQUEST_KEY_ATTRIBUTE]: input.requestKey,
          [CONTENT_STATUS_ATTRIBUTE]: 'stored',
        }),
      ],
    )
  })
}

async function seedRunWithContentKey(tenantId: string, organizationId: string, requestKey: string): Promise<string> {
  const [runId] = await insertAgentRunFixtures([
    { tenantId, organizationId, agentId: SEED_AGENT_ID, status: 'ok', createdAt: new Date() },
  ])
  await insertLlmSpanWithContentKey({ tenantId, organizationId, runId, requestKey })
  return runId
}

function artifactPath(runId: string, key: string, kind = 'llm_request'): string {
  return `/api/agent_orchestrator/runs/${runId}/artifact?kind=${kind}&key=${encodeURIComponent(key)}`
}

function promptOverridePath(agentId: string): string {
  return `/api/ai_assistant/ai/agents/${encodeURIComponent(agentId)}/prompt-override`
}

async function readPreviousOverride(
  request: APIRequestContext,
  token: string,
  agentId: string,
): Promise<Record<string, string> | null> {
  const response = await apiRequest(request, 'GET', promptOverridePath(agentId), { token })
  if (response.status() !== 200) return null
  const body = await readJsonSafe<PromptOverrideState>(response)
  return body?.override?.sections ?? {}
}

test.describe('TC-AGENT-TRACE-006: content capture artifacts', () => {
  test('the content artifact route gates on view_content, ownership, scope and retention', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(adminToken)
    const initial = await readSettings(request, adminToken)
    const previousPolicy = initial.policy ?? null
    const runIds: string[] = []
    let restricted: ScopedAgentUser | null = null

    try {
      const freshKey = fakeContentKey(organizationId, new Date())
      const ownRunId = await seedRunWithContentKey(tenantId, organizationId, freshKey)
      runIds.push(ownRunId)

      restricted = await createScopedAgentUser(request, adminToken, {
        label: 'trace-content',
        features: ['agent_orchestrator.trace.view'],
      })
      const forbidden = await apiRequest(request, 'GET', artifactPath(ownRunId, freshKey), {
        token: restricted.token,
      })
      expect(forbidden.status(), 'content kinds need trace.view_content').toBe(403)

      const unknownKey = fakeContentKey(organizationId, new Date())
      const notOwned = await apiRequest(request, 'GET', artifactPath(ownRunId, unknownKey), { token: adminToken })
      expect(notOwned.status(), 'a key not referenced by any span of the run is not served').toBe(404)

      const foreignOrganizationId = randomUUID()
      const foreignKey = fakeContentKey(foreignOrganizationId, new Date())
      const foreignRunId = await seedRunWithContentKey(tenantId, foreignOrganizationId, foreignKey)
      runIds.push(foreignRunId)
      const crossOrg = await apiRequest(request, 'GET', artifactPath(foreignRunId, foreignKey), { token: adminToken })
      expect(crossOrg.status(), "another organization's run is not visible").toBe(404)

      const fresh = await apiRequest(request, 'GET', artifactPath(ownRunId, freshKey), { token: adminToken })
      expect([410, 502], 'a key with no stored object is never served').toContain(fresh.status())

      const retentionDays = 7
      await savePolicy(request, adminToken, { ...initial.policy!, retentionDays }, initial.updatedAt)
      const expiredKey = fakeContentKey(organizationId, new Date(Date.now() - (retentionDays + 3) * DAY_MS))
      const expiredRunId = await seedRunWithContentKey(tenantId, organizationId, expiredKey)
      runIds.push(expiredRunId)
      const expired = await apiRequest(request, 'GET', artifactPath(expiredRunId, expiredKey), { token: adminToken })
      expect(expired.status(), 'content older than retentionDays is gone').toBe(410)
    } finally {
      await deleteScopedAgentUser(request, adminToken, restricted).catch(() => undefined)
      await restorePolicy(request, adminToken, previousPolicy)
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
    }
  })

  test('a full-level native run stores a request artifact with the overridden system prompt', async ({
    request,
  }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    test.skip(!(await hasConfiguredLlmProvider(request, adminToken)), NO_LLM_PROVIDER_SKIP_REASON)

    const initial = await readSettings(request, adminToken)
    test.skip(initial.deploymentCeiling !== 'full', CEILING_SKIP_REASON)

    const agentsRes = await apiRequest(request, 'GET', '/api/agent_orchestrator/agents', { token: adminToken })
    expect(agentsRes.status(), await agentsRes.text()).toBe(200)
    const agentsBody = await readJsonSafe<{ items?: AgentListItem[] }>(agentsRes)
    const agent = (agentsBody?.items ?? []).find(
      (item) => typeof item.id === 'string' && item.sampleInput !== undefined,
    )
    expect(agent, 'a registered agent with a declared sampleInput is required').toBeTruthy()
    const agentId = agent!.id!

    const runIds: string[] = []
    const previousSections = await readPreviousOverride(request, adminToken, agentId)
    let overrideSaved = false
    try {
      await savePolicy(request, adminToken, { ...initial.policy!, level: 'full', perAgent: {} }, initial.updatedAt)
      if (previousSections !== null) {
        const saveRes = await apiRequest(request, 'POST', promptOverridePath(agentId), {
          token: adminToken,
          data: { sections: { responseStyle: OVERRIDE_MARKER }, notes: 'TC-AGENT-TRACE-006 fixture' },
        })
        expect(saveRes.status(), await saveRes.text()).toBe(200)
        overrideSaved = true
      }

      const runRes = await apiRequest(request, 'POST', `/api/agent_orchestrator/agents/${encodeURIComponent(agentId)}/run`, {
        token: adminToken,
        data: { input: agent!.sampleInput },
      })
      test.skip(isModelUnavailableResponse(runRes.status()), NO_LLM_PROVIDER_SKIP_REASON)
      expect(runRes.status(), await runRes.text()).toBe(200)
      const run = await readJsonSafe<{ runId?: string | null }>(runRes)
      expect(typeof run?.runId).toBe('string')
      const runId = run!.runId!
      runIds.push(runId)

      const detailRes = await apiRequest(request, 'GET', `/api/agent_orchestrator/runs/${runId}`, { token: adminToken })
      expect(detailRes.status()).toBe(200)
      const detail = await readJsonSafe<RunDetail>(detailRes)
      const llmSpans = (detail?.spans ?? []).filter((span) => span.kind === 'llm')
      expect(llmSpans.length).toBeGreaterThan(0)
      const storedSpan = llmSpans.find(
        (span) => typeof span.attributes?.[CONTENT_REQUEST_KEY_ATTRIBUTE] === 'string',
      )
      test.skip(!storedSpan, STORAGE_SKIP_REASON)
      const requestKey = String(storedSpan!.attributes![CONTENT_REQUEST_KEY_ATTRIBUTE])

      const artifactRes = await apiRequest(request, 'GET', artifactPath(runId, requestKey), { token: adminToken })
      test.skip(artifactRes.status() === 502, STORAGE_SKIP_REASON)
      expect(artifactRes.status(), await artifactRes.text()).toBe(200)
      const artifact = await readJsonSafe<ArtifactResponse>(artifactRes)
      expect(artifact?.kind).toBe('llm_request')
      expect(artifact?.payload?.schema).toBe(LLM_REQUEST_SCHEMA)
      const systemPrompt = JSON.stringify(artifact?.payload?.system ?? null)
      expect(systemPrompt.length).toBeGreaterThan(2)
      if (overrideSaved) {
        expect(systemPrompt, 'the stored system prompt includes the tenant override').toContain(OVERRIDE_MARKER)
      }
    } finally {
      if (overrideSaved && previousSections !== null) {
        await apiRequest(request, 'POST', promptOverridePath(agentId), {
          token: adminToken,
          data: { sections: previousSections, notes: 'TC-AGENT-TRACE-006 cleanup' },
        }).catch(() => undefined)
      }
      await restorePolicy(request, adminToken, initial.policy ?? null)
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
    }
  })
})
