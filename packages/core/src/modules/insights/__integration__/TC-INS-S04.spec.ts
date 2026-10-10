import { expect, test } from '@playwright/test'
import {
  RULE_BACKTEST_KIND,
  SIMULATOR_FEATURES,
  cleanupSimulationFixture,
  createSimulationFixture,
  createSimulationOrganization,
  createSimulationUser,
  requestSimulation,
  ruleDefinition,
  uniqueSuffix,
} from './helpers/simulationApi'

export const integrationMeta = {
  description: 'Change simulator request validation (unsupported patterns, invalid proposals, missing features)',
  dependsOnModules: ['insights', 'business_rules', 'customers'],
}

/**
 * TC-INS-S04: request validation.
 * Covers POST /api/insights/simulations 422 and 403 paths.
 *
 * A rule on an entity/event pattern no module can rebuild from history answers 422
 * `unsupported_event_payload`; a proposal the business rules schema rejects answers 422
 * `invalid_proposal` with issues; an unknown kind 422 `unsupported_kind`; a caller without the
 * kind's features (rule execution logs) or without the view feature of the targeted record type
 * answers 403; a caller without `insights.simulator.run` is refused by the route guard.
 */
test.describe('TC-INS-S04: simulation request validation', () => {
  test('answers 422 and 403 before anything runs', async ({ request }) => {
    test.slow()
    const fixture = createSimulationFixture()
    try {
      const organizationId = await createSimulationOrganization(request, fixture, 'INS-S04')
      const analyst = await createSimulationUser(request, fixture, { label: 'INS-S04 analyst', organizationId })
      const stamp = uniqueSuffix()

      const unsupported = await requestSimulation(request, analyst.token, {
        kind: RULE_BACKTEST_KIND,
        proposal: ruleDefinition(`S04a_${stamp}`, { entityType: 'QaSimulationEntity', eventType: 'beforeSave' }),
      })
      expect(unsupported.status, unsupported.text).toBe(422)
      expect(unsupported.body?.code).toBe('unsupported_event_payload')

      const invalid = await requestSimulation(request, analyst.token, {
        kind: RULE_BACKTEST_KIND,
        proposal: ruleDefinition(`S04b_${stamp}`, { ruleId: '', ruleType: 'NOT_A_TYPE' }),
      })
      expect(invalid.status, invalid.text).toBe(422)
      expect(invalid.body?.code).toBe('invalid_proposal')
      expect(invalid.body?.issues?.map((issue) => issue.path)).toEqual(expect.arrayContaining(['ruleId', 'ruleType']))

      const unknownKind = await requestSimulation(request, analyst.token, { kind: 'unknown_module.kind', proposal: {} })
      expect(unknownKind.status).toBe(422)
      expect(unknownKind.body?.code).toBe('unsupported_kind')

      const noLogs = await createSimulationUser(request, fixture, {
        label: 'INS-S04 no logs',
        organizationId,
        features: SIMULATOR_FEATURES.filter((feature) => feature !== 'business_rules.view_logs'),
      })
      const kindDenied = await requestSimulation(request, noLogs.token, { kind: RULE_BACKTEST_KIND, proposal: ruleDefinition(`S04c_${stamp}`) })
      expect(kindDenied.status, kindDenied.text).toBe(403)
      expect(kindDenied.body?.requiredFeatures).toEqual(expect.arrayContaining(['business_rules.view_logs']))

      const noDeals = await createSimulationUser(request, fixture, {
        label: 'INS-S04 no deals',
        organizationId,
        features: SIMULATOR_FEATURES.filter((feature) => !feature.startsWith('customers.deals.')),
      })
      const recordDenied = await requestSimulation(request, noDeals.token, { kind: RULE_BACKTEST_KIND, proposal: ruleDefinition(`S04d_${stamp}`) })
      expect(recordDenied.status, recordDenied.text).toBe(403)
      expect(recordDenied.body?.requiredFeatures).toEqual(expect.arrayContaining(['customers.deals.view']))

      const noRun = await createSimulationUser(request, fixture, {
        label: 'INS-S04 viewer',
        organizationId,
        features: SIMULATOR_FEATURES.filter((feature) => feature !== 'insights.simulator.run'),
      })
      const guarded = await requestSimulation(request, noRun.token, { kind: RULE_BACKTEST_KIND, proposal: ruleDefinition(`S04e_${stamp}`) })
      expect(guarded.status, guarded.text).toBe(403)
    } finally {
      await cleanupSimulationFixture(request, fixture)
    }
  })
})
