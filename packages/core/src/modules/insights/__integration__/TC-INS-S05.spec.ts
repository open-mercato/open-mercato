import { expect, test } from '@playwright/test'
import {
  RULE_BACKTEST_KIND,
  SIMULATIONS_PATH,
  cleanupSimulationFixture,
  createSimulationFixture,
  createSimulationOrganization,
  createSimulationUser,
  readSimulation,
  requestSimulation,
  ruleDefinition,
  simulationCall,
  uniqueSuffix,
  waitForSimulation,
} from './helpers/simulationApi'

export const integrationMeta = {
  description: 'Change simulator runs are private to the requester and bound to one organization',
  dependsOnModules: ['insights', 'business_rules', 'customers'],
}

/**
 * TC-INS-S05: private runs.
 * Covers GET /api/insights/simulations, GET/cancel/decision of /api/insights/simulations/{id}.
 *
 * A second user of the same organization with the same features gets the same 404 as for an
 * unknown run on read, cancel and decision, never sees the run in the list, and the identical
 * request starts their own run instead of receiving the first user's run through deduplication.
 * The owner, who may also work in a second organization, gets the same 404 (and no list entry)
 * with that organization selected; the administrator gets the same 404 in the run's organization.
 */
test.describe('TC-INS-S05: simulation runs are private', () => {
  test('hides runs from other users and other organizations', async ({ request }) => {
    test.slow()
    const fixture = createSimulationFixture()
    try {
      const organizationId = await createSimulationOrganization(request, fixture, 'INS-S05')
      const otherOrganizationId = await createSimulationOrganization(request, fixture, 'INS-S05 other')
      const owner = await createSimulationUser(request, fixture, { label: 'INS-S05 owner', organizationId, organizations: [organizationId, otherOrganizationId] })
      const peer = await createSimulationUser(request, fixture, { label: 'INS-S05 peer', organizationId })
      const body = { kind: RULE_BACKTEST_KIND, proposal: ruleDefinition(`S05_${uniqueSuffix()}`), window: { days: 7 } }

      const started = await requestSimulation(request, owner.token, body)
      expect(started.status, started.text).toBe(202)
      const runId = started.body?.runId as string
      const run = await waitForSimulation(request, owner.token, runId)
      expect(run.status).toBe('completed')

      const unknown = await readSimulation(request, peer.token, '00000000-0000-4000-8000-000000000000')
      const foreign = await readSimulation(request, peer.token, runId)
      expect(unknown.status).toBe(404)
      expect(foreign.status).toBe(404)
      expect(foreign.body).toEqual(unknown.body)
      const cancel = await simulationCall(request, peer.token, 'POST', `${SIMULATIONS_PATH}/${runId}/cancel`)
      expect(cancel.status).toBe(404)
      expect(cancel.body).toEqual(unknown.body)
      const decision = await simulationCall(request, peer.token, 'POST', `${SIMULATIONS_PATH}/${runId}/decision`, { data: { decision: 'discarded' } })
      expect(decision.status).toBe(404)
      expect(decision.body).toEqual(unknown.body)
      const peerList = await simulationCall<{ items: Array<{ id: string }> }>(request, peer.token, 'GET', SIMULATIONS_PATH)
      expect(peerList.status).toBe(200)
      expect(peerList.body?.items.map((item) => item.id)).not.toContain(runId)

      const peerRun = await requestSimulation(request, peer.token, body)
      expect(peerRun.status, 'the same request of another user is never deduplicated into the owner\'s run').toBe(202)
      expect(peerRun.body?.runId).not.toBe(runId)
      expect(peerRun.body?.deduplicated).toBe(false)

      const ownerAgain = await requestSimulation(request, owner.token, body)
      expect(ownerAgain.status).toBe(200)
      expect(ownerAgain.body).toEqual(expect.objectContaining({ runId, deduplicated: true }))

      const otherOrganization = await readSimulation(request, owner.token, runId, { selectedOrgId: otherOrganizationId })
      expect(otherOrganization.status, 'a run is bound to the organization it was requested in').toBe(404)
      expect(otherOrganization.body).toEqual(unknown.body)
      const otherOrganizationList = await simulationCall<{ items: Array<{ id: string }> }>(request, owner.token, 'GET', SIMULATIONS_PATH, { selectedOrgId: otherOrganizationId })
      expect(otherOrganizationList.status).toBe(200)
      expect(otherOrganizationList.body?.items.map((item) => item.id)).not.toContain(runId)
      const admin = await readSimulation(request, fixture.adminToken as string, runId, { selectedOrgId: organizationId })
      expect(admin.status, 'runs are private even to administrators').toBe(404)
      expect(admin.body).toEqual(unknown.body)
    } finally {
      await cleanupSimulationFixture(request, fixture)
    }
  })
})
