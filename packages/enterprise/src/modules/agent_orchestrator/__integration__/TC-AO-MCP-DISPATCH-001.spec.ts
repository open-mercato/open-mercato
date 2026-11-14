import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteAgentRunsWithTraceByIds } from './helpers/agentPerfFixtures'
import {
  hasConfiguredLlmProvider,
  isModelUnavailableResponse,
  NO_LLM_PROVIDER_SKIP_REASON,
} from './helpers/llmProvider'
import {
  CORRELATION_ID_HEADER,
  GATED_AGENT_ID,
  GATED_AGENT_INPUT,
  GATED_AGENT_TOOL,
  RUN_OBJECT_PATH,
  TOOLS_EXECUTE_PATH,
  UUID_PATTERN,
  agentRunPath,
  uniqueStamp,
} from './helpers/agentAccessFixtures'

/**
 * TC-AO-MCP-DISPATCH-001: ai-assistant doors delegate orchestrator agents to the AO dispatcher.
 * Sources: spec .ai/specs/2026-10-21-mcp-tool-exposure-parity-and-audit.md (`TC-AO-MCP-DISPATCH-001`)
 * and .ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-invocation-access-and-identity-binding.md
 * (Integration: run-object with the AO agent id; tool built with `defineAgentTool`).
 *
 * Model-dependent: every case executes a real `support.ticket_triage` run. The
 * provider pre-filter skips environments without a provider; a direct run on the
 * orchestrator run route is the authoritative witness (503 → skip), so the two
 * dispatcher cases below only run where a model can actually answer.
 *
 *   - `run-object` answers `{ runId: null, agentRunId }`; the `AgentRun` manifest
 *     carries `om.entry_point = 'ai_assistant'`, `om.channel = 'run-object'` and the
 *     request correlation id.
 *   - `/tools/execute` on `agent_examples.triage_ticket` answers
 *     `{ result, agentId, runId: null, agentRunId }`; the manifest carries
 *     `om.entry_point = 'tool'` and the same correlation id as the tool-call audit
 *     row, which also records the `agentRunId`.
 *
 * Cleanup: every created `AgentRun` (and its trace rows) is deleted in `finally`.
 */

const MCP_AUDIT_RESOURCE_KIND = 'ai_assistant.mcp_tool_call'
const ACCESS_LOGS_PATH = '/api/audit_logs/audit-logs/access'

type SpanRow = { name?: string; attributes?: Record<string, unknown> | null }
type RunDetail = { spans?: SpanRow[] }
type RunObjectBody = { runId?: unknown; agentRunId?: unknown; object?: unknown }
type ToolExecuteBody = {
  success?: boolean
  error?: string
  result?: { result?: unknown; agentId?: unknown; runId?: unknown; agentRunId?: unknown }
}
type AccessLogItem = { resourceId?: string; context?: Record<string, unknown> | null }

async function readManifestAttributes(
  request: APIRequestContext,
  token: string,
  runId: string,
): Promise<Record<string, unknown>> {
  const response = await apiRequest(request, 'GET', `/api/agent_orchestrator/runs/${runId}`, { token })
  expect(response.status(), await response.text()).toBe(200)
  const detail = await readJsonSafe<RunDetail>(response)
  const manifests = (detail?.spans ?? []).filter((span) => span.name === 'run.manifest')
  expect(manifests, 'exactly one run.manifest span per run').toHaveLength(1)
  return manifests[0].attributes ?? {}
}

test.describe('TC-AO-MCP-DISPATCH-001: ai-assistant doors dispatch AO agents', () => {
  test('run-object and the agent tool create AgentRuns with the door recorded in the manifest', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await hasConfiguredLlmProvider(request, token)), NO_LLM_PROVIDER_SKIP_REASON)

    const runIds: string[] = []
    try {
      const witness = await apiRequest(request, 'POST', agentRunPath(GATED_AGENT_ID), {
        token,
        data: { input: GATED_AGENT_INPUT },
      })
      test.skip(isModelUnavailableResponse(witness.status()), NO_LLM_PROVIDER_SKIP_REASON)
      const witnessRaw = await witness.text()
      expect(witness.status(), witnessRaw).toBe(200)
      const witnessRunId = (JSON.parse(witnessRaw) as { runId?: unknown }).runId
      if (typeof witnessRunId === 'string') runIds.push(witnessRunId)

      const runObjectCorrelation = `it-ao-dispatch-ro-${uniqueStamp()}`
      const runObject = await apiRequest(request, 'POST', RUN_OBJECT_PATH, {
        token,
        headers: { [CORRELATION_ID_HEADER]: runObjectCorrelation },
        data: {
          agent: GATED_AGENT_ID,
          messages: [{ role: 'user', content: JSON.stringify(GATED_AGENT_INPUT) }],
        },
      })
      const runObjectRaw = await runObject.text()
      expect(runObject.status(), runObjectRaw).toBe(200)
      const runObjectBody = JSON.parse(runObjectRaw) as RunObjectBody
      expect(runObjectBody.runId).toBeNull()
      expect(String(runObjectBody.agentRunId)).toMatch(UUID_PATTERN)
      const runObjectRunId = String(runObjectBody.agentRunId)
      runIds.push(runObjectRunId)

      const runObjectManifest = await readManifestAttributes(request, token, runObjectRunId)
      expect(runObjectManifest['om.entry_point']).toBe('ai_assistant')
      expect(runObjectManifest['om.channel']).toBe('run-object')
      expect(runObjectManifest['om.correlation_id']).toBe(runObjectCorrelation)

      const toolCorrelation = `it-ao-dispatch-tool-${uniqueStamp()}`
      const execute = await apiRequest(request, 'POST', TOOLS_EXECUTE_PATH, {
        token,
        headers: { [CORRELATION_ID_HEADER]: toolCorrelation },
        data: { toolName: GATED_AGENT_TOOL, args: GATED_AGENT_INPUT },
      })
      const executeRaw = await execute.text()
      expect(execute.status(), executeRaw).toBe(200)
      const executeBody = JSON.parse(executeRaw) as ToolExecuteBody
      expect(executeBody.success).toBe(true)
      expect(executeBody.result?.agentId).toBe(GATED_AGENT_ID)
      expect(executeBody.result?.runId).toBeNull()
      expect(String(executeBody.result?.agentRunId)).toMatch(UUID_PATTERN)
      const toolRunId = String(executeBody.result?.agentRunId)
      runIds.push(toolRunId)

      const toolManifest = await readManifestAttributes(request, token, toolRunId)
      expect(toolManifest['om.entry_point']).toBe('tool')
      expect(toolManifest['om.channel']).toBe('tools-api')
      expect(toolManifest['om.correlation_id']).toBe(toolCorrelation)

      let auditRow: AccessLogItem | undefined
      await expect
        .poll(
          async () => {
            const response = await apiRequest(
              request,
              'GET',
              `${ACCESS_LOGS_PATH}?resourceKind=${encodeURIComponent(MCP_AUDIT_RESOURCE_KIND)}&pageSize=50`,
              { token },
            )
            if (response.status() !== 200) return false
            const body = await readJsonSafe<{ items?: AccessLogItem[] }>(response)
            auditRow = (body?.items ?? []).find((item) => item.context?.correlationId === toolCorrelation)
            return Boolean(auditRow)
          },
          { timeout: 15_000, message: 'the agent tool call writes an audit row with its correlation id' },
        )
        .toBe(true)
      expect(auditRow!.resourceId).toBe(GATED_AGENT_TOOL)
      expect(auditRow!.context?.agentRunId).toBe(toolRunId)
    } finally {
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
    }
  })
})
