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
 * TC-WF-010: WAIT_FOR_TIMER step pauses, fires, and resumes end-to-end
 *
 * Relies on the `workflow-activities` queue worker that the ephemeral
 * integration runner now boots via AUTO_SPAWN_WORKERS. The worker drains the
 * delayed timer job once its availableAt is reached, calls `fireTimer`, and
 * the workflow transitions through to END.
 */
test.describe('TC-WF-010: WAIT_FOR_TIMER step fires and completes', () => {
  test('workflow paused at WAIT_FOR_TIMER resumes and completes once the timer fires', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const workflowId = `qa-wf-010-${timestamp}`

    const definitionPayload = {
      workflowId,
      workflowName: `QA TC-WF-010 ${timestamp}`,
      description: 'Integration test: WAIT_FOR_TIMER step resumes via worker',
      version: 1,
      enabled: true,
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          {
            stepId: 'wait_for_timer',
            stepName: 'Wait 1 second',
            stepType: 'WAIT_FOR_TIMER',
            config: { duration: 'PT1S' },
          },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [
          {
            transitionId: 'start-to-timer',
            fromStepId: 'start',
            toStepId: 'wait_for_timer',
            trigger: 'auto',
          },
          {
            transitionId: 'timer-to-end',
            fromStepId: 'wait_for_timer',
            toStepId: 'end',
            trigger: 'auto',
          },
        ],
      },
    }

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, definitionPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId,
        initialContext: { test: true },
      })

      // Phase 1: instance must pause at the WAIT_FOR_TIMER step.
      const pauseDeadline = Date.now() + 5_000
      let pausedStatus: string | undefined
      let pausedStepId: string | undefined
      while (Date.now() < pauseDeadline) {
        const response = await apiRequest(
          request,
          'GET',
          `/api/workflows/instances/${encodeURIComponent(instanceId)}`,
          { token },
        )
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<{ data?: { status?: string; currentStepId?: string } }>(response)
        pausedStatus = body?.data?.status
        pausedStepId = body?.data?.currentStepId
        if (
          (pausedStatus === 'PAUSED' && pausedStepId === 'wait_for_timer') ||
          pausedStatus === 'COMPLETED' ||
          pausedStatus === 'FAILED'
        ) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 150))
      }

      // The worker may fire fast enough that we miss the PAUSED window and see
      // COMPLETED directly — that's a stronger proof, so accept it.
      if (pausedStatus !== 'COMPLETED') {
        expect(
          pausedStatus,
          `Instance should pause at WAIT_FOR_TIMER before firing (status=${pausedStatus}, step=${pausedStepId})`,
        ).toBe('PAUSED')
        expect(pausedStepId).toBe('wait_for_timer')

        // Phase 2 (only if we caught the pause): TIMER_AWAITING event was logged.
        const eventsResponse = await apiRequest(
          request,
          'GET',
          `/api/workflows/instances/${encodeURIComponent(instanceId)}/events?eventType=TIMER_AWAITING`,
          { token },
        )
        expect(eventsResponse.status()).toBe(200)
        const eventsBody = await readJsonSafe<{
          data?: Array<{ eventType?: string; eventData?: { jobId?: string; fireAt?: string } }>
        }>(eventsResponse)
        const timerAwaiting = eventsBody?.data ?? []
        expect(
          timerAwaiting.length,
          'TIMER_AWAITING event should be logged when the timer is scheduled',
        ).toBeGreaterThanOrEqual(1)
        expect(timerAwaiting[0]?.eventData?.jobId, 'TIMER_AWAITING should include jobId').toBeTruthy()
        expect(timerAwaiting[0]?.eventData?.fireAt, 'TIMER_AWAITING should include fireAt').toBeTruthy()
      }

      // Phase 3: worker drains the delayed job, fireTimer resumes, instance completes.
      const completeDeadline = Date.now() + 10_000
      let finalStatus: string | undefined
      let finalBody: { data?: { status?: string } } | null = null
      while (Date.now() < completeDeadline) {
        const response = await apiRequest(
          request,
          'GET',
          `/api/workflows/instances/${encodeURIComponent(instanceId)}`,
          { token },
        )
        expect(response.status()).toBe(200)
        finalBody = await readJsonSafe<{ data?: { status?: string } }>(response)
        finalStatus = finalBody?.data?.status
        if (finalStatus === 'COMPLETED' || finalStatus === 'FAILED') break
        await new Promise((resolve) => setTimeout(resolve, 250))
      }

      expect(
        finalStatus,
        `Workflow should resume and complete after timer fires (status=${finalStatus}, body=${JSON.stringify(finalBody)})`,
      ).toBe('COMPLETED')

      // Phase 4: TIMER_FIRED event is logged as the resume signal.
      const firedResponse = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/events?eventType=TIMER_FIRED`,
        { token },
      )
      expect(firedResponse.status()).toBe(200)
      const firedBody = await readJsonSafe<{ data?: Array<{ eventType?: string }> }>(firedResponse)
      expect(
        (firedBody?.data ?? []).length,
        'TIMER_FIRED event should be logged when the worker resumes the workflow',
      ).toBeGreaterThanOrEqual(1)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
