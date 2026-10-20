import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  RULE_BACKTEST_KIND,
  SIMULATIONS_PATH,
  cleanupSimulationFixture,
  createSimulationFixture,
  createSimulationOrganization,
  createSimulationUser,
  readProgressJob,
  requestProgressJobCancellation,
  readSimulation,
  requestSimulation,
  ruleDefinition,
  simulationCall,
  uniqueSuffix,
  waitForSimulation,
  withSimulationSlicesPaused,
} from './helpers/simulationApi'

export const integrationMeta = {
  description: 'Change simulator cancellation (requester only; ProgressJob reconciliation) and minimal ProgressJob metadata',
  dependsOnModules: ['insights', 'business_rules', 'customers', 'progress'],
}

/**
 * TC-INS-S03: cancellation and ProgressJob hygiene.
 * Covers POST /api/insights/simulations/{id}/cancel, DELETE /api/progress/jobs/{id} refusal and the
 * worker's ProgressJob reconciliation.
 *
 * While the tenant's simulation slices are paused (the spec holds the slice lock every slice
 * takes), a run stays active deterministically. The requester cancels one run through the
 * simulator. The shared progress bar cannot cancel a private run (its ProgressJob is not
 * cancellable: any `progress.cancel` holder of the organization could otherwise cancel another
 * user's run); a ProgressJob cancelled by any other path is still authoritative and the worker
 * reconciles the run to `cancelled`. Every simulation ProgressJob carries a generic name,
 * `meta = { runId }` and no totals or result summary, so the progress bar never leaks the
 * proposal or its results.
 */
test.describe('TC-INS-S03: simulation cancellation and ProgressJob hygiene', () => {
  test('cancels through the simulator and through the ProgressJob without leaking run data', async ({ request }) => {
    test.slow()
    const fixture = createSimulationFixture()
    try {
      const organizationId = await createSimulationOrganization(request, fixture, 'INS-S03')
      const user = await createSimulationUser(request, fixture, { label: 'INS-S03 analyst', organizationId })
      const tenantId = getTokenScope(user.token).tenantId as string
      const proposal = (suffix: string) => ruleDefinition(`S03_${suffix}_${uniqueSuffix()}`)

      await withSimulationSlicesPaused(tenantId, async () => {
        const first = await requestSimulation(request, user.token, { kind: RULE_BACKTEST_KIND, proposal: proposal('a'), window: { days: 7 } })
        expect(first.status, first.text).toBe(202)
        const firstRunId = first.body?.runId as string
        const cancelled = await simulationCall<{ ok?: boolean; status?: string }>(request, user.token, 'POST', `${SIMULATIONS_PATH}/${firstRunId}/cancel`)
        expect(cancelled.status, cancelled.text).toBe(200)
        expect(cancelled.body).toEqual(expect.objectContaining({ ok: true, status: 'cancelled' }))
        const again = await simulationCall<{ code?: string }>(request, user.token, 'POST', `${SIMULATIONS_PATH}/${firstRunId}/cancel`)
        expect(again.status).toBe(409)
        expect(again.body?.code).toBe('run_not_active')
        const firstJob = await readProgressJob(first.body?.progressJobId as string)
        expect(firstJob?.status).toBe('cancelled')

        const second = await requestSimulation(request, user.token, { kind: RULE_BACKTEST_KIND, proposal: proposal('b'), window: { days: 7 } })
        expect(second.status, second.text).toBe(202)
        const secondJobId = second.body?.progressJobId as string
        const deleted = await apiRequest(request, 'DELETE', `/api/progress/jobs/${secondJobId}`, { token: user.token })
        expect(deleted.status(), `the progress bar cannot cancel a private run: ${await deleted.text()}`).toBe(400)
        const job = await readProgressJob(secondJobId)
        expect(job).toEqual(expect.objectContaining({ job_type: 'insights.simulation', name: 'Change simulation', description: null, total_count: null, result_summary: null }))
        expect(['pending', 'running'], 'the refused cancellation leaves the job active').toContain(job?.status)
        expect(job?.meta).toEqual({ runId: second.body?.runId })
        expect(JSON.stringify(job)).not.toContain('QA_SIM_')
        await requestProgressJobCancellation(secondJobId)
        return second.body?.runId as string
      }).then(async (secondRunId) => {
        const reconciled = await waitForSimulation(request, user.token, secondRunId)
        expect(reconciled.status, 'the worker treats the ProgressJob cancellation as authoritative').toBe('cancelled')
        expect(reconciled.result).toBeNull()
      })

      const completed = await requestSimulation(request, user.token, { kind: RULE_BACKTEST_KIND, proposal: proposal('c'), window: { days: 7 } })
      expect(completed.status, completed.text).toBe(202)
      const finished = await waitForSimulation(request, user.token, completed.body?.runId as string)
      expect(finished.status).toBe('completed')
      const finishedJob = await readProgressJob(completed.body?.progressJobId as string)
      expect(finishedJob).toEqual(expect.objectContaining({ status: 'completed', name: 'Change simulation', total_count: null, result_summary: null }))
      expect(finishedJob?.meta).toEqual({ runId: completed.body?.runId })
      const readAfter = await readSimulation(request, user.token, completed.body?.runId as string)
      expect(readAfter.status).toBe(200)
    } finally {
      await cleanupSimulationFixture(request, fixture)
    }
  })
})
