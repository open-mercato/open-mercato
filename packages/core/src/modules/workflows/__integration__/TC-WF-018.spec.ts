import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { deleteWorkflowDefinitionIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'

/**
 * TC-WF-018: PARALLEL_FORK / PARALLEL_JOIN definition validation (fail-closed)
 *
 * Invalid fork/join structures must be rejected at definition save time
 * (POST /api/workflows/definitions → 400), never accepted then exploded at run.
 */
test.describe('TC-WF-018: parallel fork/join definition validation', () => {
  const base = (timestamp: number, suffix: string) => ({
    workflowId: `qa-wf-018-${suffix}-${timestamp}`,
    workflowName: `QA TC-WF-018 ${suffix} ${timestamp}`,
    version: 1,
    enabled: true,
  })

  async function expectRejected(request: any, token: string, payload: Record<string, unknown>) {
    const response = await apiRequest(request, 'POST', '/api/workflows/definitions', { token, data: payload })
    const body = await readJsonSafe<{ data?: { id?: string }; error?: unknown }>(response)
    // Clean up if it unexpectedly succeeded so the suite stays self-contained.
    if (response.status() === 201 && body?.data?.id) {
      await deleteWorkflowDefinitionIfExists(request, token, body.data.id)
    }
    expect(
      response.status(),
      `Invalid fork/join definition should be rejected (got ${response.status()}: ${JSON.stringify(body)})`,
    ).toBe(400)
  }

  test('rejects a fork missing config.joinStepId', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ts = Date.now()
    await expectRejected(request, token, {
      ...base(ts, 'nojoin'),
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: 'fork', stepName: 'Fork', stepType: 'PARALLEL_FORK' },
          { stepId: 'a', stepName: 'A', stepType: 'AUTOMATED' },
          { stepId: 'b', stepName: 'B', stepType: 'AUTOMATED' },
          { stepId: 'join', stepName: 'Join', stepType: 'PARALLEL_JOIN', config: { forkStepId: 'fork' } },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [
          { transitionId: 't1', fromStepId: 'start', toStepId: 'fork', trigger: 'auto' },
          { transitionId: 't2', fromStepId: 'fork', toStepId: 'a', trigger: 'auto' },
          { transitionId: 't3', fromStepId: 'fork', toStepId: 'b', trigger: 'auto' },
          { transitionId: 't4', fromStepId: 'a', toStepId: 'join', trigger: 'auto' },
          { transitionId: 't5', fromStepId: 'b', toStepId: 'join', trigger: 'auto' },
          { transitionId: 't6', fromStepId: 'join', toStepId: 'end', trigger: 'auto' },
        ],
      },
    })
  })

  test('rejects a nested fork inside a branch', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ts = Date.now()
    await expectRejected(request, token, {
      ...base(ts, 'nested'),
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: 'fork', stepName: 'Fork', stepType: 'PARALLEL_FORK', config: { joinStepId: 'join' } },
          { stepId: 'a', stepName: 'A', stepType: 'AUTOMATED' },
          { stepId: 'inner_fork', stepName: 'Inner', stepType: 'PARALLEL_FORK', config: { joinStepId: 'inner_join' } },
          { stepId: 'x', stepName: 'X', stepType: 'AUTOMATED' },
          { stepId: 'y', stepName: 'Y', stepType: 'AUTOMATED' },
          { stepId: 'inner_join', stepName: 'InnerJoin', stepType: 'PARALLEL_JOIN', config: { forkStepId: 'inner_fork' } },
          { stepId: 'join', stepName: 'Join', stepType: 'PARALLEL_JOIN', config: { forkStepId: 'fork' } },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [
          { transitionId: 't1', fromStepId: 'start', toStepId: 'fork', trigger: 'auto' },
          { transitionId: 't2', fromStepId: 'fork', toStepId: 'a', trigger: 'auto' },
          { transitionId: 't3', fromStepId: 'fork', toStepId: 'inner_fork', trigger: 'auto' },
          { transitionId: 't4', fromStepId: 'a', toStepId: 'join', trigger: 'auto' },
          { transitionId: 't5', fromStepId: 'inner_fork', toStepId: 'x', trigger: 'auto' },
          { transitionId: 't6', fromStepId: 'inner_fork', toStepId: 'y', trigger: 'auto' },
          { transitionId: 't7', fromStepId: 'x', toStepId: 'inner_join', trigger: 'auto' },
          { transitionId: 't8', fromStepId: 'y', toStepId: 'inner_join', trigger: 'auto' },
          { transitionId: 't9', fromStepId: 'inner_join', toStepId: 'join', trigger: 'auto' },
          { transitionId: 't10', fromStepId: 'join', toStepId: 'end', trigger: 'auto' },
        ],
      },
    })
  })

  test('rejects a branch that bypasses the join (reaches END)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ts = Date.now()
    await expectRejected(request, token, {
      ...base(ts, 'bypass'),
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: 'fork', stepName: 'Fork', stepType: 'PARALLEL_FORK', config: { joinStepId: 'join' } },
          { stepId: 'a', stepName: 'A', stepType: 'AUTOMATED' },
          { stepId: 'b', stepName: 'B', stepType: 'AUTOMATED' },
          { stepId: 'join', stepName: 'Join', stepType: 'PARALLEL_JOIN', config: { forkStepId: 'fork' } },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [
          { transitionId: 't1', fromStepId: 'start', toStepId: 'fork', trigger: 'auto' },
          { transitionId: 't2', fromStepId: 'fork', toStepId: 'a', trigger: 'auto' },
          { transitionId: 't3', fromStepId: 'fork', toStepId: 'b', trigger: 'auto' },
          { transitionId: 't4', fromStepId: 'a', toStepId: 'join', trigger: 'auto' },
          { transitionId: 't5', fromStepId: 'b', toStepId: 'end', trigger: 'auto' }, // bypasses join
          { transitionId: 't6', fromStepId: 'join', toStepId: 'end', trigger: 'auto' },
        ],
      },
    })
  })
})
