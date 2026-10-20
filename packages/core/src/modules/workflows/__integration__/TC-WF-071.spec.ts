import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  listWorkflowInstanceEvents,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
  type WorkflowEventSnapshot,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-071: an async-activity wait resolves only from the queue jobs it
 * enqueued.
 *
 * The event log keeps every `ACTIVITY_COMPLETED` / `ACTIVITY_FAILED` of the
 * run. A later transition that parks on two async jobs must not resume when
 * only one of them finished (earlier waits' completions do not count), and a
 * step rerun after an async failure must resume once its new job completes
 * (the earlier attempt's failure does not count).
 *
 * Needs the workflow-activities worker (AUTO_SPAWN_WORKERS=true) — same skip
 * condition as TC-WF-016.
 */
const IS_STANDALONE_APP = Boolean(process.env.OM_TEST_APP_ROOT?.trim())

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED'])

function asyncActivity(activityId: string, activityType: string, config: Record<string, unknown>) {
  return { activityId, activityName: activityId, activityType, async: true, config }
}

function byOccurredAt(left: WorkflowEventSnapshot, right: WorkflowEventSnapshot): number {
  return new Date(left.occurredAt ?? 0).getTime() - new Date(right.occurredAt ?? 0).getTime()
}

async function waitForEvents(
  request: APIRequestContext,
  token: string,
  instanceId: string,
  predicate: (events: WorkflowEventSnapshot[]) => boolean,
  timeoutMs: number,
): Promise<WorkflowEventSnapshot[]> {
  const deadline = Date.now() + timeoutMs
  let events: WorkflowEventSnapshot[] = []
  while (Date.now() < deadline) {
    events = await listWorkflowInstanceEvents(request, token, instanceId)
    if (predicate(events)) return events
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return events
}

test.describe('TC-WF-071: async-activity wait resolves from its own jobs', () => {
  test('a later two-job wait does not resume before both of its jobs complete', async ({ request }) => {
    test.skip(IS_STANDALONE_APP, 'Async resume needs the workflow-activities worker (AUTO_SPAWN_WORKERS=false in standalone)')
    test.setTimeout(120_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const workflowId = `qa-wf-071-wait-${stamp}`
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, {
        workflowId,
        workflowName: `QA TC-WF-071 wait ${stamp}`,
        version: 1,
        enabled: true,
        definition: {
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' },
            { stepId: 'middle', stepName: 'Middle', stepType: 'AUTOMATED' },
            { stepId: 'done', stepName: 'Done', stepType: 'AUTOMATED' },
            { stepId: 'end', stepName: 'End', stepType: 'END' },
          ],
          transitions: [
            {
              transitionId: 'start-to-middle',
              fromStepId: 'start',
              toStepId: 'middle',
              trigger: 'auto',
              activities: [asyncActivity('first', 'WAIT', { duration: 'PT1S' })],
            },
            {
              transitionId: 'middle-to-done',
              fromStepId: 'middle',
              toStepId: 'done',
              trigger: 'auto',
              activities: [
                asyncActivity('quick', 'WAIT', { duration: 'PT1S' }),
                asyncActivity('slow', 'WAIT', { duration: 'PT8S' }),
              ],
            },
            { transitionId: 'done-to-end', fromStepId: 'done', toStepId: 'end', trigger: 'auto' },
          ],
        },
      })
      instanceId = await startWorkflowInstanceFixture(request, token, { workflowId, initialContext: {} })

      const finished = await pollWorkflowInstance(
        request,
        token,
        instanceId,
        (instance) => TERMINAL_STATUSES.has(instance.status ?? ''),
        { timeoutMs: 60_000 },
      )
      expect(finished?.status).toBe('COMPLETED')

      const events = await waitForEvents(
        request,
        token,
        instanceId,
        (all) => all.some((event) => event.eventType === 'ACTIVITY_COMPLETED' && event.eventData?.activityId === 'slow'),
        30_000,
      )
      const ordered = [...events].sort(byOccurredAt)
      const slowCompletedAt = ordered.findIndex(
        (event) => event.eventType === 'ACTIVITY_COMPLETED' && event.eventData?.activityId === 'slow',
      )
      const doneEnteredAt = ordered.findIndex(
        (event) => event.eventType === 'STEP_ENTERED' && event.eventData?.stepId === 'done',
      )
      expect(slowCompletedAt, 'the slow job completes').toBeGreaterThanOrEqual(0)
      expect(doneEnteredAt, 'the run enters the step after the two-job wait').toBeGreaterThanOrEqual(0)
      expect(doneEnteredAt, 'the run must not leave the wait before its slow job completes').toBeGreaterThan(slowCompletedAt)

      const completed = await pollWorkflowInstance(request, token, instanceId, () => true)
      expect(completed?.context?.slow_result, 'the slow job output is merged into the context').toBeTruthy()
      expect(completed?.context?.quick_result).toBeTruthy()
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('a step rerun after an async failure resumes once its new job completes', async ({ request }) => {
    test.skip(IS_STANDALONE_APP, 'Async resume needs the workflow-activities worker (AUTO_SPAWN_WORKERS=false in standalone)')
    test.setTimeout(120_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const workflowId = `qa-wf-071-rerun-${stamp}`
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, {
        workflowId,
        workflowName: `QA TC-WF-071 rerun ${stamp}`,
        version: 1,
        enabled: true,
        definition: {
          interpolation: 'lenient',
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' },
            { stepId: 'prepare', stepName: 'Prepare', stepType: 'AUTOMATED' },
            { stepId: 'end', stepName: 'End', stepType: 'END' },
          ],
          transitions: [
            { transitionId: 'start-to-prepare', fromStepId: 'start', toStepId: 'prepare', trigger: 'auto' },
            {
              transitionId: 'prepare-to-end',
              fromStepId: 'prepare',
              toStepId: 'end',
              trigger: 'auto',
              activities: [
                asyncActivity('notify', 'EMIT_EVENT', {
                  eventName: 'qa.workflows.tc_wf_071.notified',
                  payload: { reference: '{{context.reference}}' },
                }),
              ],
            },
          ],
        },
      })
      instanceId = await startWorkflowInstanceFixture(request, token, { workflowId, initialContext: {} })

      const failed = await pollWorkflowInstance(
        request,
        token,
        instanceId,
        (instance) => TERMINAL_STATUSES.has(instance.status ?? ''),
        { timeoutMs: 60_000 },
      )
      expect(failed?.status, 'the unresolved payload makes the async job fail').toBe('FAILED')
      const failedJobIds = (await listWorkflowInstanceEvents(request, token, instanceId, { eventType: 'ACTIVITY_FAILED' }))
        .map((event) => event.eventData?.jobId)
      expect(failedJobIds.length).toBeGreaterThan(0)

      const rerun = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/rerun-step`,
        { token, data: { stepId: 'prepare', contextPatch: { reference: 'REF-071' } } },
      )
      const rerunBody = await readJsonSafe<Record<string, unknown>>(rerun)
      expect(rerun.status(), `rerun-step should return 200 (got ${rerun.status()}: ${JSON.stringify(rerunBody)})`).toBe(200)

      const finished = await pollWorkflowInstance(
        request,
        token,
        instanceId,
        (instance) => TERMINAL_STATUSES.has(instance.status ?? ''),
        { timeoutMs: 60_000 },
      )
      expect(finished?.status, 'the rerun resumes once its own job completes').toBe('COMPLETED')
      expect(finished?.context?.notify_result).toBeTruthy()

      const completedEvents = await listWorkflowInstanceEvents(request, token, instanceId, { eventType: 'ACTIVITY_COMPLETED' })
      const rerunJobIds = completedEvents.map((event) => event.eventData?.jobId)
      expect(rerunJobIds).toHaveLength(1)
      expect(failedJobIds).not.toContain(rerunJobIds[0])
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
