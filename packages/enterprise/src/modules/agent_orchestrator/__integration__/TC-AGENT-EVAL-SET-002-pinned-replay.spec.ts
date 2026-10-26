import { randomInt } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteAgentEvalCasesByIds, deleteAgentRunsWithTraceByIds } from './helpers/agentPerfFixtures'
import {
  createApprovedEvalCase,
  deleteEvalSuiteRunsByIds,
  firstRegisteredAgentId,
} from './helpers/evalReportFixtures'
import { hasConfiguredLlmProvider } from './helpers/llmProvider'

/**
 * TC-AGENT-EVAL-SET-002: pinned eval-set replays.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-10-21-eval-reports-and-reproducible-regression.md
 * (Frozen eval-set manifests, Integration coverage).
 *
 * A run started with `snapshot: 'latest'` freezes the approved cases and
 * assertions into a manifest whose hash becomes the run's evalSetVersion.
 * Replaying that hash after the live case was edited must replay the FROZEN
 * case: same version, same manifest, the first run as its same-dataset baseline,
 * and the original input handed to the agent. The replay itself does not need a
 * model to complete (a case without one ends errored, not missing), so only the
 * input check through the produced agent run depends on a configured provider.
 * The snapshot validation contract (unknown hash, malformed value) is rejected
 * before any replay and never needs a model.
 */

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'
const EVAL_RUNS_PATH = '/api/agent_orchestrator/eval-runs'

type EvalRunDetailBody = {
  run?: {
    eval_set_version?: string | null
    summary?: { __evalSet?: { version?: string } } | null
  }
  caseRuns?: Array<{ eval_case_id?: string; agent_run_id?: string | null; error_message?: string | null }>
}

type EvalReportBody = {
  evalSet?: { version?: string | null; pinKind?: string; manifestHash?: string | null; assertionCount?: number }
  baseline?: { suiteRunId?: string | null; manifestHash?: string | null; sameDataset?: boolean | null }
  cases?: Array<{ id?: string; trials?: Array<{ error?: string | null }> }>
}

async function startPinnedRun(
  request: APIRequestContext,
  token: string,
  agentDefinitionId: string,
  evalCaseId: string,
  snapshot: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', EVAL_RUNS_PATH, {
    token,
    data: { agentDefinitionId, evalCaseIds: [evalCaseId], snapshot, repeatCount: 1, judgeMayGate: false },
  })
  expect(response.status(), await response.text()).toBe(200)
  const suiteRunId = (await readJsonSafe<{ suiteRunId?: string }>(response))?.suiteRunId ?? ''
  expect(suiteRunId, 'a synchronous pinned eval run must return its suite run id').toBeTruthy()
  return suiteRunId
}

async function readRunDetail(request: APIRequestContext, token: string, suiteRunId: string): Promise<EvalRunDetailBody> {
  const response = await apiRequest(request, 'GET', `${EVAL_RUNS_PATH}/${encodeURIComponent(suiteRunId)}`, { token })
  expect(response.status(), await response.text()).toBe(200)
  return (await readJsonSafe<EvalRunDetailBody>(response)) ?? {}
}

async function readReport(request: APIRequestContext, token: string, suiteRunId: string): Promise<EvalReportBody> {
  const response = await apiRequest(
    request,
    'GET',
    `${EVAL_RUNS_PATH}/${encodeURIComponent(suiteRunId)}/report?format=json`,
    { token },
  )
  expect(response.status(), await response.text()).toBe(200)
  return (await readJsonSafe<EvalReportBody>(response)) ?? {}
}

function collectAgentRunIds(detail: EvalRunDetailBody): string[] {
  return (detail.caseRuns ?? [])
    .map((caseRun) => caseRun.agent_run_id ?? null)
    .filter((agentRunId): agentRunId is string => typeof agentRunId === 'string' && agentRunId.length > 0)
}

test.describe('TC-AGENT-EVAL-SET-002: pinned eval-set replay', () => {
  test('replaying a frozen snapshot hash reruns the original case after the live case was edited', async ({ request }) => {
    test.slow()

    const token = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const agentId = await firstRegisteredAgentId(request, token)
    const createdEvalCaseIds: string[] = []
    const suiteRunIds: string[] = []
    const agentRunIds: string[] = []
    let assertionId: string | null = null

    try {
      const caseName = `qa-eval-set-002-${stamp}`
      const evalCaseId = await createApprovedEvalCase(request, token, agentId, caseName)
      createdEvalCaseIds.push(evalCaseId)
      const originalInput = { question: `${caseName} input` }

      const assertionRes = await apiRequest(request, 'POST', '/api/agent_orchestrator/eval-assertions', {
        token,
        data: {
          key: `qa-eval-set-002-${stamp}`,
          title: `QA eval set 002 ${stamp}`,
          type: 'deterministic',
          scorerKey: 'json_path_compare',
          config: { path: '$.ok', operator: 'eq', value: 'true' },
          severity: 'warn',
          appliesTo: agentId,
          enabled: true,
        },
      })
      expect(assertionRes.status(), await assertionRes.text()).toBe(201)
      assertionId = (await readJsonSafe<{ id?: string }>(assertionRes))?.id ?? null
      expect(assertionId, 'assertion create must return an id').toBeTruthy()

      const firstRunId = await startPinnedRun(request, token, agentId, evalCaseId, 'latest')
      suiteRunIds.push(firstRunId)
      const firstDetail = await readRunDetail(request, token, firstRunId)
      agentRunIds.push(...collectAgentRunIds(firstDetail))
      const firstHash = firstDetail.run?.eval_set_version ?? ''
      expect(firstHash.startsWith('sha256:'), 'a latest snapshot pins the run to its manifest hash').toBe(true)
      expect(firstDetail.run?.summary?.__evalSet?.version).toBe(firstHash)

      const firstReport = await readReport(request, token, firstRunId)
      expect(firstReport.evalSet?.pinKind).toBe('hash')
      expect(firstReport.evalSet?.version).toBe(firstHash)
      expect(firstReport.evalSet?.manifestHash).toBe(firstHash)
      expect(firstReport.evalSet?.assertionCount ?? 0).toBeGreaterThanOrEqual(1)

      const editRes = await apiRequest(request, 'PUT', '/api/agent_orchestrator/eval-cases', {
        token,
        data: { id: evalCaseId, input: { question: `${caseName} edited input` } },
      })
      expect(editRes.status(), await editRes.text()).toBe(200)
      const reapproveRes = await apiRequest(
        request,
        'POST',
        `/api/agent_orchestrator/eval-cases/${encodeURIComponent(evalCaseId)}/approve`,
        { token },
      )
      expect(reapproveRes.status(), await reapproveRes.text()).toBe(200)

      const secondRunId = await startPinnedRun(request, token, agentId, evalCaseId, firstHash)
      suiteRunIds.push(secondRunId)
      const secondDetail = await readRunDetail(request, token, secondRunId)
      const secondAgentRunIds = collectAgentRunIds(secondDetail)
      agentRunIds.push(...secondAgentRunIds)
      expect(secondDetail.run?.eval_set_version, 'the replay keeps the pinned hash').toBe(firstHash)
      expect(secondDetail.run?.summary?.__evalSet?.version).toBe(firstHash)
      for (const caseRun of secondDetail.caseRuns ?? []) {
        expect(caseRun.eval_case_id).toBe(evalCaseId)
        expect(caseRun.error_message ?? '', 'the frozen case must resolve from the manifest').not.toContain('eval_set_')
      }

      const secondReport = await readReport(request, token, secondRunId)
      expect(secondReport.evalSet?.pinKind).toBe('hash')
      expect(secondReport.evalSet?.version).toBe(firstHash)
      expect(secondReport.evalSet?.manifestHash).toBe(firstHash)
      expect(secondReport.baseline?.suiteRunId, 'the previous run of the same pin is the baseline').toBe(firstRunId)
      expect(secondReport.baseline?.manifestHash).toBe(firstHash)
      expect(secondReport.baseline?.sameDataset).toBe(true)

      const providerReady = await hasConfiguredLlmProvider(request, token)
      const replayedRunId = secondAgentRunIds[0] ?? null
      if (!replayedRunId) {
        expect(providerReady, 'with a configured provider the replay must produce an agent run').toBe(false)
        return
      }
      const runRes = await apiRequest(
        request,
        'GET',
        `/api/agent_orchestrator/runs/${encodeURIComponent(replayedRunId)}`,
        { token },
      )
      expect(runRes.status(), await runRes.text()).toBe(200)
      const replayedRun = (await readJsonSafe<{ run?: { input?: unknown } }>(runRes))?.run
      expect(replayedRun?.input, 'the pinned replay must run the ORIGINAL frozen input').toEqual(originalInput)
    } finally {
      await deleteAgentRunsWithTraceByIds(agentRunIds).catch(() => undefined)
      await deleteEvalSuiteRunsByIds(suiteRunIds).catch(() => undefined)
      await deleteAgentEvalCasesByIds(createdEvalCaseIds).catch(() => undefined)
      if (assertionId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/agent_orchestrator/eval-assertions?id=${encodeURIComponent(assertionId)}`,
          { token },
        ).catch(() => undefined)
      }
    }
  })

  test('an unknown snapshot hash is 404 eval_set_unresolved and a malformed snapshot is 400', async ({ request }) => {
    const token = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)
    const agentId = await firstRegisteredAgentId(request, token)
    const unknownHash = `sha256:${'0'.repeat(64)}`

    const unknown = await apiRequest(request, 'POST', EVAL_RUNS_PATH, {
      token,
      data: { agentDefinitionId: agentId, snapshot: unknownHash, repeatCount: 1, judgeMayGate: false },
    })
    expect(unknown.status(), await unknown.text()).toBe(404)
    expect((await readJsonSafe<{ code?: string }>(unknown))?.code).toBe('eval_set_unresolved')

    for (const snapshot of ['sha256:not-a-hash', `sha256:${'A'.repeat(64)}`, 'newest']) {
      const malformed = await apiRequest(request, 'POST', EVAL_RUNS_PATH, {
        token,
        data: { agentDefinitionId: agentId, snapshot, repeatCount: 1, judgeMayGate: false },
      })
      expect(malformed.status(), `snapshot "${snapshot}" must be rejected`).toBe(400)
    }
  })
})
