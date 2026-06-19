import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'

/**
 * TC-WF-016: a FORK branch with an async activity pauses on the
 * workflow-activities queue and resumes per-branch once the worker drains the
 * job; the JOIN fires after the async branch completes.
 *
 * Needs the workflow-activities worker (AUTO_SPAWN_WORKERS=true) — same skip
 * condition as TC-WF-013.
 */
const IS_STANDALONE_APP = Boolean(process.env.OM_TEST_APP_ROOT?.trim())

test.describe('TC-WF-016: parallel branch with an async activity', () => {
  test('async branch pauses, the worker resumes it, and the join completes', async ({ request }) => {
    test.skip(IS_STANDALONE_APP, 'Async branch resume needs the workflow-activities worker (AUTO_SPAWN_WORKERS=false in standalone)')
    test.setTimeout(120_000)

    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const workflowId = `qa-wf-016-${timestamp}`

    const definitionPayload = {
      workflowId,
      workflowName: `QA TC-WF-016 ${timestamp}`,
      version: 1,
      enabled: true,
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: 'fork', stepName: 'Fork', stepType: 'PARALLEL_FORK', config: { joinStepId: 'join' } },
          { stepId: 'auto_branch', stepName: 'Auto', stepType: 'AUTOMATED' },
          { stepId: 'async_step', stepName: 'Async', stepType: 'AUTOMATED' },
          { stepId: 'join', stepName: 'Join', stepType: 'PARALLEL_JOIN', config: { forkStepId: 'fork' } },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [
          { transitionId: 'start-to-fork', fromStepId: 'start', toStepId: 'fork', trigger: 'auto' },
          { transitionId: 'fork-to-auto', fromStepId: 'fork', toStepId: 'auto_branch', trigger: 'auto' },
          {
            transitionId: 'fork-to-async',
            fromStepId: 'fork',
            toStepId: 'async_step',
            trigger: 'auto',
            activities: [
              { activityId: 'async_wait', activityName: 'Async Wait', activityType: 'WAIT', config: { duration: 'PT1S' }, async: true },
            ],
          },
          { transitionId: 'auto-to-join', fromStepId: 'auto_branch', toStepId: 'join', trigger: 'auto' },
          { transitionId: 'async-to-join', fromStepId: 'async_step', toStepId: 'join', trigger: 'auto' },
          { transitionId: 'join-to-end', fromStepId: 'join', toStepId: 'end', trigger: 'auto' },
        ],
      },
    }

    let definitionId: string | null = null
    let instanceId: string | null = null
    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, definitionPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, { workflowId, initialContext: {} })

      const deadline = Date.now() + 90_000
      let status: string | undefined
      while (Date.now() < deadline) {
        const response = await apiRequest(request, 'GET', `/api/workflows/instances/${encodeURIComponent(instanceId)}`, { token })
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<{ data?: { status?: string } }>(response)
        status = body?.data?.status
        if (status === 'COMPLETED' || status === 'FAILED') break
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      expect(status, `Workflow should complete after the async branch resumes (status=${status})`).toBe('COMPLETED')
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
