import { expect, test, type APIRequestContext } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteAgentRunsWithTraceByIds } from './helpers/agentPerfFixtures'
import {
  hasConfiguredLlmProvider,
  isModelUnavailableResponse,
  NO_LLM_PROVIDER_SKIP_REASON,
} from './helpers/llmProvider'

/**
 * TC-AGENT-TRACE-004: a native run records its run manifest.
 *
 * Runs a registered agent through `POST /api/agent_orchestrator/agents/:id/run`
 * after saving a tenant prompt override for it, then asserts the trace carries
 * exactly one `run.manifest` span with the definition hash, the override
 * reference, and a user invoker; the run row stamps a short `sha256:` agent
 * version; and the trace page renders the Versions & identity card. When the
 * agent is unknown to the prompt-override API, the override is asserted absent.
 * The override fixture is reverted to its previous sections in `finally`.
 */

const integrationDirectory = path.dirname(fileURLToPath(import.meta.url))
const englishMessages = JSON.parse(
  readFileSync(path.join(integrationDirectory, '../i18n/en.json'), 'utf8'),
) as Record<string, string>

const MANIFEST_TITLE_KEY = 'agent_orchestrator.traces.detail.manifest.title'
const OVERRIDE_SECTIONS = { responseStyle: 'Keep every answer short and factual.' }

type AgentListItem = { id?: string; sampleInput?: unknown }
type PromptOverrideState = { override?: { sections?: Record<string, string> } | null }
type PromptOverrideSaved = { version?: number }
type RunResponse = { runId?: string | null }
type ManifestInvoker = { kind?: string }
type SpanRow = { name?: string; kind?: string; attributes?: Record<string, unknown> | null }
type RunDetail = {
  run?: { agentVersion?: string | null; agent_version?: string | null }
  spans?: SpanRow[]
}

function englishMessage(key: string): string {
  const message = englishMessages[key]
  if (!message) throw new Error(`[internal] en.json is missing "${key}"`)
  return message
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

test.describe('TC-AGENT-TRACE-004: run manifest span', () => {
  test('a native run writes one run.manifest span surfaced on the trace page', async ({ page, request }) => {
    test.slow()

    const token = await getAuthToken(request, 'admin')
    test.skip(!(await hasConfiguredLlmProvider(request, token)), NO_LLM_PROVIDER_SKIP_REASON)

    const agentsRes = await apiRequest(request, 'GET', '/api/agent_orchestrator/agents', { token })
    expect(agentsRes.status(), await agentsRes.text()).toBe(200)
    const agentsBody = await readJsonSafe<{ items?: AgentListItem[] }>(agentsRes)
    const agent = (agentsBody?.items ?? []).find(
      (item) => typeof item.id === 'string' && item.sampleInput !== undefined,
    )
    expect(agent, 'a registered agent with a declared sampleInput is required').toBeTruthy()
    const agentId = agent!.id!

    const runIds: string[] = []
    const previousSections = await readPreviousOverride(request, token, agentId)
    let overrideVersion: number | null = null
    try {
      if (previousSections !== null) {
        const saveRes = await apiRequest(request, 'POST', promptOverridePath(agentId), {
          token,
          data: { sections: OVERRIDE_SECTIONS, notes: 'TC-AGENT-TRACE-004 fixture' },
        })
        expect(saveRes.status(), await saveRes.text()).toBe(200)
        const saved = await readJsonSafe<PromptOverrideSaved>(saveRes)
        expect(typeof saved?.version).toBe('number')
        overrideVersion = saved!.version!
      }

      const runRes = await apiRequest(
        request,
        'POST',
        `/api/agent_orchestrator/agents/${encodeURIComponent(agentId)}/run`,
        { token, data: { input: agent!.sampleInput } },
      )
      test.skip(isModelUnavailableResponse(runRes.status()), NO_LLM_PROVIDER_SKIP_REASON)
      expect(runRes.status(), await runRes.text()).toBe(200)
      const run = await readJsonSafe<RunResponse>(runRes)
      expect(typeof run?.runId).toBe('string')
      const runId = run!.runId!
      runIds.push(runId)

      const detailRes = await apiRequest(request, 'GET', `/api/agent_orchestrator/runs/${runId}`, { token })
      expect(detailRes.status()).toBe(200)
      const detail = await readJsonSafe<RunDetail>(detailRes)
      const manifestSpans = (detail?.spans ?? []).filter((span) => span.name === 'run.manifest')
      expect(manifestSpans, 'exactly one run.manifest span is written per run').toHaveLength(1)
      const attributes = manifestSpans[0].attributes ?? {}

      const definitionHash = attributes['om.agent.definition_hash']
      expect(typeof definitionHash).toBe('string')
      expect(String(definitionHash)).toMatch(/^sha256:/)

      const invoker = attributes['om.invoker'] as ManifestInvoker | undefined
      expect(invoker?.kind).toBe('user')

      const override = attributes['om.prompt.override'] as { id?: string; version?: number } | undefined
      if (overrideVersion === null) {
        expect(override, 'no prompt-override path exists for this agent').toBeUndefined()
      } else {
        expect(typeof override?.id).toBe('string')
        expect(override?.version).toBe(overrideVersion)
      }

      const agentVersion = detail?.run?.agentVersion ?? detail?.run?.agent_version ?? null
      expect(typeof agentVersion).toBe('string')
      expect(String(agentVersion)).toMatch(/^sha256:/)

      await login(page, 'admin')
      await page.goto(`/backend/traces/${runId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByText(englishMessage(MANIFEST_TITLE_KEY), { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      })
    } finally {
      if (overrideVersion !== null && previousSections !== null) {
        await apiRequest(request, 'POST', promptOverridePath(agentId), {
          token,
          data: { sections: previousSections, notes: 'TC-AGENT-TRACE-004 cleanup' },
        }).catch(() => undefined)
      }
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
    }
  })
})
