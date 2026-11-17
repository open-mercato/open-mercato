import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteAgentRunsWithTraceByIds } from './helpers/agentPerfFixtures'
import {
  hasConfiguredLlmProvider,
  isModelUnavailableResponse,
  NO_LLM_PROVIDER_SKIP_REASON,
} from './helpers/llmProvider'

/**
 * TC-AGENT-RUN-CALLSETTINGS-001: call-time model settings on the AO run doors (B-10).
 *
 * - `POST /agents/:id/run` and `POST /runs/:id/rerun` accept an optional
 *   `callSettings` with the run-object HTTP contract (strict keys, capped values,
 *   no `providerOptions`); a bad value is a 422 before any model work.
 * - A file-defined (OpenCode) agent refuses non-empty `callSettings` with
 *   `call_settings_unsupported` instead of silently running on its defaults.
 * - Live (LLM provider required): a native run records the sent
 *   `maxOutputTokens` on its llm spans, and `seed` either as sent or, when the
 *   provider dropped it, in `om.params.ignored` (never both).
 */

type AgentListItem = { id?: string; sampleInput?: unknown; runtime?: string; invocable?: boolean }
type RunDetail = { spans?: Array<{ kind?: string; attributes?: Record<string, unknown> }> }

async function listAgents(request: Parameters<typeof apiRequest>[0], token: string): Promise<AgentListItem[]> {
  const response = await apiRequest(request, 'GET', '/api/agent_orchestrator/agents', { token })
  expect(response.status(), await response.text()).toBe(200)
  const body = await readJsonSafe<{ items?: AgentListItem[] }>(response)
  return body?.items ?? []
}

function runPath(agentId: string): string {
  return `/api/agent_orchestrator/agents/${encodeURIComponent(agentId)}/run`
}

test.describe('TC-AGENT-RUN-CALLSETTINGS-001: call-time model settings on AO run doors', () => {
  test('rejects invalid callSettings with 422 before running', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const agents = await listAgents(request, token)
    const agent = agents.find((item) => typeof item.id === 'string' && item.invocable !== false)
    expect(agent, 'a registered agent is required').toBeTruthy()

    for (const callSettings of [
      { providerOptions: { openai: { store: true } } },
      { temperature: 0.2, notARealSetting: true },
      { maxOutputTokens: 1_000_000 },
    ]) {
      const response = await apiRequest(request, 'POST', runPath(agent!.id!), {
        token,
        data: { input: agent!.sampleInput ?? {}, callSettings },
      })
      expect(response.status(), `${JSON.stringify(callSettings)} → ${await response.text()}`).toBe(422)
    }

    const rerun = await apiRequest(request, 'POST', `/api/agent_orchestrator/runs/${randomUUID()}/rerun`, {
      token,
      data: { callSettings: { topP: 5 } },
    })
    expect(rerun.status(), await rerun.text()).toBe(422)
  })

  test('a file-defined OpenCode agent refuses callSettings instead of ignoring them', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const agents = await listAgents(request, token)
    const fileAgent = agents.find((item) => item.runtime === 'opencode' && item.invocable !== false)
    test.skip(!fileAgent, 'no invocable file-defined agent is registered in this app')

    const response = await apiRequest(request, 'POST', runPath(fileAgent!.id!), {
      token,
      data: { input: fileAgent!.sampleInput ?? {}, callSettings: { temperature: 0 } },
    })
    expect(response.status(), await response.text()).toBe(422)
    const body = await readJsonSafe<{ code?: string }>(response)
    expect(body?.code).toBe('call_settings_unsupported')
  })

  test('a native run applies and records the sent callSettings', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await hasConfiguredLlmProvider(request, token)), NO_LLM_PROVIDER_SKIP_REASON)
    const agents = await listAgents(request, token)
    const agent = agents.find(
      (item) => typeof item.id === 'string' && item.sampleInput !== undefined && item.runtime !== 'opencode' && item.invocable !== false,
    )
    expect(agent, 'a registered native agent with a declared sampleInput is required').toBeTruthy()

    const runIds: string[] = []
    try {
      const response = await apiRequest(request, 'POST', runPath(agent!.id!), {
        token,
        data: { input: agent!.sampleInput, callSettings: { maxOutputTokens: 4096, seed: 7 } },
      })
      test.skip(isModelUnavailableResponse(response.status()), NO_LLM_PROVIDER_SKIP_REASON)
      expect(response.status(), await response.text()).toBe(200)
      const run = await readJsonSafe<{ runId?: string | null }>(response)
      expect(typeof run?.runId).toBe('string')
      runIds.push(run!.runId!)

      const detail = await apiRequest(request, 'GET', `/api/agent_orchestrator/runs/${run!.runId}`, { token })
      expect(detail.status()).toBe(200)
      const llmSpans = ((await readJsonSafe<RunDetail>(detail))?.spans ?? []).filter((span) => span.kind === 'llm')
      expect(llmSpans.length).toBeGreaterThan(0)
      for (const span of llmSpans) {
        expect(span.attributes?.['gen_ai.request.max_tokens']).toBe(4096)
        // A provider may drop a setting it does not support (the OpenAI Responses API drops `seed`);
        // the trace then names it in om.params.ignored instead of claiming it was applied.
        const ignored = (span.attributes?.['om.params.ignored'] as string[] | undefined) ?? []
        if (ignored.includes('seed')) {
          expect(span.attributes).not.toHaveProperty('gen_ai.request.seed')
        } else {
          expect(span.attributes?.['gen_ai.request.seed']).toBe(7)
        }
      }
    } finally {
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
    }
  })
})
