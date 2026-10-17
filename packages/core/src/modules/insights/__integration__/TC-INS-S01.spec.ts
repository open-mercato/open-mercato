import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import {
  OPTIMISTIC_LOCK_HEADER,
  RULES_PATH,
  RULE_BACKTEST_KIND,
  SIMULATIONS_PATH,
  cellOf,
  cleanupSimulationFixture,
  createRule,
  createSimulationFixture,
  createSimulationOrganization,
  createSimulationUser,
  groupOf,
  readRuleUpdatedAt,
  requestSimulation,
  ruleDefinition,
  seedUpdatedDeals,
  simulationCall,
  uniqueSuffix,
  waitForSimulation,
} from './helpers/simulationApi'

export const integrationMeta = {
  description: 'Change simulator rule backtest end to end (observed + reconstructed tiers, k-suppression, apply and decisions)',
  dependsOnModules: ['insights', 'business_rules', 'customers', 'audit_logs', 'progress'],
}

/**
 * TC-INS-S01: rule backtest end to end.
 * Covers POST/GET /api/insights/simulations, POST /api/insights/simulations/{id}/decision and the
 * rule PUT apply path with the optimistic lock.
 *
 * Six deals of a fresh organization are created and updated once. An existing rule on
 * `customers.deal` / `updated` runs on every update, so the CRUD rule trigger writes one observed
 * execution log per update event; the six creates have no log and are rebuilt from the audit
 * history (fidelity `mixed`). The simulated proposal replaces that rule and fires for two deals
 * only: with k = 5 both the two `fires` events and the four events that run the failure actions
 * are reported as "fewer than k" (no counts, no samples), while the group total of six stays
 * visible. Applying with a stale `updatedAt` answers 409; the applied definition verifies, a
 * differing one does not.
 */
test.describe('TC-INS-S01: rule backtest end to end', () => {
  test('simulates a rule change, suppresses small cells and verifies the applied decision', async ({ request }) => {
    test.slow()
    const fixture = createSimulationFixture()
    try {
      const organizationId = await createSimulationOrganization(request, fixture, 'INS-S01')
      const user = await createSimulationUser(request, fixture, { label: 'INS-S01 analyst', organizationId })
      const stamp = uniqueSuffix()
      const ruleId = await createRule(request, user.token, ruleDefinition(`S01_${stamp}`))
      const dealIds = await seedUpdatedDeals(request, user.token, fixture, organizationId, 6, 'INS-S01')

      const proposal = ruleDefinition(`S01_${stamp}`, {
        conditionExpression: { field: 'id', operator: 'IN', value: dealIds.slice(0, 2) },
      })
      const started = await requestSimulation(request, user.token, { kind: RULE_BACKTEST_KIND, artifactId: ruleId, proposal, window: { days: 30 } })
      expect(started.status, `POST ${SIMULATIONS_PATH}: ${started.text}`).toBe(202)
      expect(started.body).toEqual(expect.objectContaining({ ok: true, status: 'queued', deduplicated: false }))
      const runId = started.body?.runId as string
      expect(started.body?.progressJobId).toBeTruthy()

      const again = await requestSimulation(request, user.token, { kind: RULE_BACKTEST_KIND, artifactId: ruleId, proposal, window: { days: 30 } })
      expect(again.status, 'an identical live request of the same user is deduplicated').toBe(200)
      expect(again.body).toEqual(expect.objectContaining({ runId, deduplicated: true }))

      const run = await waitForSimulation(request, user.token, runId)
      expect(run.status, JSON.stringify(run)).toBe('completed')
      expect(run.fidelity).toBe('mixed')
      expect(run.result?.k).toBe(5)
      expect(run.coverage).toEqual(expect.objectContaining({ observed_events: 6, reconstructed_events: 6, reconstructed_covered_by_observed: 6 }))

      const updated = groupOf(run, 'customers.deal.updated')
      expect(updated.total).toBe(6)
      expect(cellOf(updated, 'fires')).toEqual(expect.objectContaining({ count: null, suppressed: 'below_k', samples: [] }))
      expect(cellOf(updated, 'runs_failure_actions')).toEqual(expect.objectContaining({ count: null, suppressed: 'below_k', samples: [] }))
      expect(cellOf(updated, 'does_not_fire').count).toBe(0)
      expect(cellOf(updated, 'cannot_tell').count).toBe(0)

      const created = groupOf(run, 'customers.deal.created')
      expect(created.total).toBe(6)
      expect(cellOf(created, 'does_not_fire').count).toBe(6)
      expect(created.warnings).toContain('business_rules.simulation.warnings.eventTypeMismatch')
      expect(run.caveats).toEqual(expect.arrayContaining(['business_rules.simulation.caveats.firstOrder']))
      expect(run.applyHref).toBe(`/backend/rules/${ruleId}?simulationRunId=${runId}`)
      expect(JSON.stringify(run.result)).not.toContain('QA INS-S01')

      const currentUpdatedAt = await readRuleUpdatedAt(request, user.token, ruleId)
      const staleApply = await apiRequest(request, 'PUT', RULES_PATH, {
        token: user.token,
        headers: { [OPTIMISTIC_LOCK_HEADER]: '2020-01-01T00:00:00.000Z' },
        data: { ...proposal, id: ruleId },
      })
      expect(staleApply.status(), `apply with a stale updatedAt: ${await staleApply.text()}`).toBe(409)

      const apply = await apiRequest(request, 'PUT', RULES_PATH, {
        token: user.token,
        headers: { [OPTIMISTIC_LOCK_HEADER]: currentUpdatedAt },
        data: { ...proposal, id: ruleId },
      })
      expect(apply.status(), `apply the simulated definition: ${await apply.text()}`).toBe(200)

      const applied = await simulationCall<{ ok?: boolean; decision?: { decision: string; verified: boolean | null } }>(request, user.token, 'POST', `${SIMULATIONS_PATH}/${runId}/decision`, { data: { decision: 'applied' } })
      expect(applied.status, `record the applied decision: ${applied.text}`).toBe(201)
      expect(applied.body?.decision).toEqual(expect.objectContaining({ decision: 'applied', verified: true }))
      const duplicate = await simulationCall<{ code?: string }>(request, user.token, 'POST', `${SIMULATIONS_PATH}/${runId}/decision`, { data: { decision: 'applied' } })
      expect(duplicate.status).toBe(409)
      expect(duplicate.body?.code).toBe('decision_exists')
      const forged = await simulationCall(request, user.token, 'POST', `${SIMULATIONS_PATH}/${runId}/decision`, { data: { decision: 'applied', verified: true } })
      expect(forged.status, 'the client never declares the verification').toBe(400)

      const secondProposal = ruleDefinition(`S01_${stamp}`, { conditionExpression: { field: 'id', operator: 'IS_NOT_EMPTY', value: null } })
      const second = await requestSimulation(request, user.token, { kind: RULE_BACKTEST_KIND, artifactId: ruleId, proposal: secondProposal, window: { days: 30 } })
      expect(second.status, second.text).toBe(202)
      const secondRun = await waitForSimulation(request, user.token, second.body?.runId as string)
      expect(secondRun.status).toBe('completed')
      expect(cellOf(groupOf(secondRun, 'customers.deal.updated'), 'fires').count).toBe(6)
      const differing = await apiRequest(request, 'PUT', RULES_PATH, {
        token: user.token,
        headers: { [OPTIMISTIC_LOCK_HEADER]: await readRuleUpdatedAt(request, user.token, ruleId) },
        data: { ...secondProposal, id: ruleId, conditionExpression: { field: 'status', operator: '=', value: 'lost' } },
      })
      expect(differing.status(), await differing.text()).toBe(200)
      const unverified = await simulationCall<{ decision?: { verified: boolean | null } }>(request, user.token, 'POST', `${SIMULATIONS_PATH}/${secondRun.id}/decision`, { data: { decision: 'applied' } })
      expect(unverified.status, unverified.text).toBe(201)
      expect(unverified.body?.decision?.verified, 'what was saved differs from what was simulated').toBe(false)
      const listed = await simulationCall<{ items: Array<{ id: string }> }>(request, user.token, 'GET', `${SIMULATIONS_PATH}?page=1&pageSize=10`)
      expect(listed.status).toBe(200)
      expect(listed.body?.items.map((item) => item.id)).toEqual(expect.arrayContaining([runId, secondRun.id]))
    } finally {
      await cleanupSimulationFixture(request, fixture)
    }
  })
})
