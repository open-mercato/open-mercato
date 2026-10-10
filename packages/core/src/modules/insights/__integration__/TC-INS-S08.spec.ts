import { expect, test } from '@playwright/test'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  RULE_BACKTEST_KIND,
  cleanupSimulationFixture,
  createSimulationFixture,
  createSimulationOrganization,
  createSimulationUser,
  insertActiveRuns,
  requestSimulation,
  ruleDefinition,
  uniqueSuffix,
} from './helpers/simulationApi'

export const integrationMeta = {
  description: 'Change simulator active-run limits',
  dependsOnModules: ['insights', 'business_rules', 'customers'],
}

/**
 * TC-INS-S08: busy limits.
 * Covers POST /api/insights/simulations 429 `simulation_busy`.
 *
 * A user who already has two active runs (seeded as queued runs, so queue workers cannot race the
 * assertion) gets 429 `simulation_busy` (`reason: user`) for a third one, in any organization of
 * the tenant; another user of the same organization is not affected.
 */
test.describe('TC-INS-S08: simulation busy limits', () => {
  test('refuses a third active run of one user', async ({ request }) => {
    test.slow()
    const fixture = createSimulationFixture()
    try {
      const organizationId = await createSimulationOrganization(request, fixture, 'INS-S08')
      const busy = await createSimulationUser(request, fixture, { label: 'INS-S08 busy', organizationId })
      const other = await createSimulationUser(request, fixture, { label: 'INS-S08 other', organizationId })
      const tenantId = getTokenScope(busy.token).tenantId as string
      await insertActiveRuns({ tenantId, organizationId, userId: busy.userId, count: 2 })

      const refused = await requestSimulation(request, busy.token, { kind: RULE_BACKTEST_KIND, proposal: ruleDefinition(`S08a_${uniqueSuffix()}`), window: { days: 7 } })
      expect(refused.status, refused.text).toBe(429)
      expect(refused.body).toEqual(expect.objectContaining({ code: 'simulation_busy', reason: 'user' }))
      expect(typeof refused.body?.error).toBe('string')

      const allowed = await requestSimulation(request, other.token, { kind: RULE_BACKTEST_KIND, proposal: ruleDefinition(`S08b_${uniqueSuffix()}`), window: { days: 7 } })
      expect(allowed.status, allowed.text).toBe(202)
    } finally {
      await cleanupSimulationFixture(request, fixture)
    }
  })
})
