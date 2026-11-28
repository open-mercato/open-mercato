import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  buildSignalDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  getWorkflowInstanceSnapshot,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-078 [P1]: a bulk retry skips a run that is waiting on a signal.
 *
 * Bulk retry is meant for runs the engine parked for triage (FAILED, or PAUSED
 * with the attention marker). A PAUSED run without that marker is healthily
 * waiting; forcing it to RUNNING leaves it at its wait step where no signal can
 * resume it again. The batch must count it as skipped and leave it PAUSED, and
 * the signal it waits for must still complete it.
 *
 * Surfaces under test:
 * - POST /api/workflows/instances/bulk-replay
 * - GET  /api/progress/jobs/[id]
 * - POST /api/workflows/instances/[id]/signal
 */

const SIGNAL_NAME = 'approval'

type ProgressJobBody = {
  status?: string
  resultSummary?: { action?: string; affectedCount?: number; skippedCount?: number; failedCount?: number }
}

test.describe('TC-WF-078: bulk retry leaves a waiting run alone', () => {
  test('a run waiting on a signal is skipped and still resumes when the signal arrives', async ({ request }) => {
    test.setTimeout(180_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now() * 1_000 + randomInt(1_000)
    const payload = buildSignalDefinitionPayload(stamp, SIGNAL_NAME, '-bulk-retry')

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
        correlationKey: `qa-bulk-retry-${stamp}`,
      })

      const paused = await pollWorkflowInstance(request, token, instanceId, (instance) => instance.status === 'PAUSED', {
        timeoutMs: 40_000,
      })
      expect(paused?.currentStepId).toBe('wait')
      expect(paused?.retryCount ?? 0).toBe(0)

      const replay = await apiRequest(request, 'POST', '/api/workflows/instances/bulk-replay', {
        token,
        data: { action: 'retry', ids: [instanceId] },
      })
      const replayBody = await readJsonSafe<{ ok?: boolean; progressJobId?: string | null }>(replay)
      expect(replay.status(), `bulk replay is accepted (got ${replay.status()}: ${JSON.stringify(replayBody)})`).toBe(202)
      const progressJobId = replayBody?.progressJobId
      expect(progressJobId).toBeTruthy()

      await drainIntegrationQueue('workflow-instance-bulk-replay')

      let jobBody: ProgressJobBody | null = null
      await expect
        .poll(
          async () => {
            const job = await apiRequest(request, 'GET', `/api/progress/jobs/${progressJobId}`, { token })
            jobBody = await readJsonSafe<ProgressJobBody>(job)
            return jobBody?.status ?? null
          },
          { timeout: 60_000, intervals: [250, 500, 1_000] },
        )
        .toBe('completed')
      expect(jobBody).toMatchObject({
        resultSummary: { action: 'retry', affectedCount: 0, skippedCount: 1, failedCount: 0 },
      })

      const after = await getWorkflowInstanceSnapshot(request, token, instanceId)
      expect(after?.status, 'the waiting run is still PAUSED').toBe('PAUSED')
      expect(after?.currentStepId).toBe('wait')
      expect(after?.retryCount ?? 0, 'the waiting run was not replayed').toBe(0)

      const signal = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/signal`,
        { token, data: { signalName: SIGNAL_NAME } },
      )
      expect(signal.status(), 'the signal it was waiting for is still accepted').toBe(200)

      const completed = await pollWorkflowInstance(
        request,
        token,
        instanceId,
        (instance) => instance.status === 'COMPLETED',
        { timeoutMs: 40_000 },
      )
      expect(completed?.status).toBe('COMPLETED')
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
