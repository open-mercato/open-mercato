import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import {
  OPTIMISTIC_LOCK_HEADER,
  SIMULATIONS_PATH,
  TRIGGER_BACKTEST_KIND,
  WORKFLOW_DEFINITIONS_PATH,
  WORKFLOW_SIMULATOR_FEATURES,
  cellOf,
  cleanupSimulationFixture,
  countWorkflowInstances,
  createSimulationFixture,
  createSimulationOrganization,
  createSimulationUser,
  groupOf,
  readWorkflowDefinition,
  requestSimulation,
  seedUpdatedDeals,
  simulationCall,
  triggerProposal,
  uniqueSuffix,
  waitForSimulation,
  workflowDefinitionPayload,
  type TriggerFixture,
} from './helpers/simulationApi'

export const integrationMeta = {
  description: 'Change simulator workflow trigger backtest end to end (debounce, filters, maxConcurrentInstances, apply and decisions)',
  dependsOnModules: ['insights', 'workflows', 'customers', 'audit_logs', 'progress'],
}

const HOUR_MS = 60 * 60 * 1000

/**
 * TC-INS-S06: workflow trigger backtest end to end.
 * Covers POST/GET /api/insights/simulations for `workflows.trigger_backtest`, POST
 * /api/insights/simulations/{id}/decision and the definition PUT apply path with the optimistic lock.
 *
 * Ten deals of a fresh organization (k = 5) are created and updated once. A DISABLED workflow
 * definition exists (so nothing starts in production); the proposal enables it with four triggers:
 * a debounced `customers.deal.*` trigger starts on every create and is debounced on the update of
 * the same deal; a filtered `customers.deal.updated` trigger matches five of the ten deals; a
 * `customers.deal.created` trigger with `maxConcurrentInstances` is "cannot tell" for every event;
 * a trigger filtering on a field CRUD payloads never carry never matches. The run starts no
 * workflow instance. Applying with a stale `updatedAt` answers 409; the applied definition
 * verifies, a differing one does not. A code-defined workflow must be customized first (422), and a
 * caller without `workflows.definitions.view` is refused (403).
 */
test.describe('TC-INS-S06: workflow trigger backtest end to end', () => {
  test('simulates trigger changes with debounce and concurrency, then verifies the applied decision', async ({ request }) => {
    test.slow()
    const fixture = createSimulationFixture()
    const workflowId = `qa_sim_s06_${uniqueSuffix()}`.toLowerCase().replace(/[^a-z0-9._-]/g, '_')
    let definitionId: string | null = null
    let token: string | null = null
    try {
      const organizationId = await createSimulationOrganization(request, fixture, 'INS-S06')
      const user = await createSimulationUser(request, fixture, { label: 'INS-S06 author', organizationId, features: WORKFLOW_SIMULATOR_FEATURES })
      token = user.token
      const dealIds = await seedUpdatedDeals(request, user.token, fixture, organizationId, 10, 'INS-S06')

      const created = await simulationCall<{ data?: { id?: string } }>(request, user.token, 'POST', WORKFLOW_DEFINITIONS_PATH, {
        data: workflowDefinitionPayload(workflowId, { enabled: false, triggers: [{ triggerId: 'initial', name: 'Initial', eventPattern: 'customers.deal.created' }] }),
      })
      expect(created.status, `POST ${WORKFLOW_DEFINITIONS_PATH}: ${created.text}`).toBe(201)
      definitionId = created.body?.data?.id as string
      expect(definitionId).toBeTruthy()

      const triggers: TriggerFixture[] = [
        { triggerId: 'debounced', name: 'Every deal event', eventPattern: 'customers.deal.*', config: { debounceMs: HOUR_MS } },
        { triggerId: 'filtered', name: 'Selected deals', eventPattern: 'customers.deal.updated', config: { filterConditions: [{ field: 'id', operator: 'in', value: dealIds.slice(0, 5) }] } },
        { triggerId: 'limited', name: 'Limited starts', eventPattern: 'customers.deal.created', config: { maxConcurrentInstances: 2 } },
        { triggerId: 'never', name: 'Won deals', eventPattern: 'customers.deal.updated', config: { filterConditions: [{ field: 'status', operator: 'eq', value: 'won' }] } },
      ]
      const proposal = triggerProposal(workflowId, { enabled: true, triggers })
      const started = await requestSimulation(request, user.token, { kind: TRIGGER_BACKTEST_KIND, artifactId: definitionId, proposal, window: { days: 30 } })
      expect(started.status, `POST ${SIMULATIONS_PATH}: ${started.text}`).toBe(202)
      const runId = started.body?.runId as string

      const run = await waitForSimulation(request, user.token, runId)
      expect(run.status, JSON.stringify(run)).toBe('completed')
      expect(run.fidelity).toBe('reconstructed')
      expect(run.result?.k).toBe(5)
      expect(run.coverage).toEqual(expect.objectContaining({ reconstructed_events: 20 }))

      const debouncedCreated = groupOf(run, 'debounced:customers.deal.created')
      expect(debouncedCreated.total).toBe(10)
      expect(cellOf(debouncedCreated, 'would_start').count).toBe(10)
      expect(cellOf(debouncedCreated, 'would_start').samples.length).toBeGreaterThan(0)
      const debouncedUpdated = groupOf(run, 'debounced:customers.deal.updated')
      expect(cellOf(debouncedUpdated, 'debounced').count).toBe(10)
      expect(cellOf(debouncedUpdated, 'would_start').count).toBe(0)

      const filtered = groupOf(run, 'filtered:customers.deal.updated')
      expect(cellOf(filtered, 'would_start').count).toBe(5)
      expect(cellOf(filtered, 'would_not_start').count).toBe(5)

      const limited = groupOf(run, 'limited:customers.deal.created')
      expect(cellOf(limited, 'cannot_tell').count).toBe(10)
      expect(cellOf(limited, 'would_start').count).toBe(0)
      expect(limited.warnings).toContain('workflows.simulation.warnings.maxConcurrentInstances')

      const never = groupOf(run, 'never:customers.deal.updated')
      expect(cellOf(never, 'would_not_start').count).toBe(10)
      expect(never.warnings).toContain('workflows.simulation.warnings.neverMatches')

      expect(run.caveats).toEqual(expect.arrayContaining(['workflows.simulation.caveats.firstOrder', 'workflows.simulation.caveats.debounceProcess']))
      expect(run.applyHref).toBe(`/backend/definitions/visual-editor?id=${definitionId}&simulationRunId=${runId}`)
      expect(JSON.stringify(run.result)).not.toContain('QA INS-S06')
      expect(await countWorkflowInstances(organizationId, workflowId), 'a backtest never starts a workflow').toBe(0)

      const saved = await readWorkflowDefinition(request, user.token, definitionId)
      const applyBody = { enabled: true, definition: { ...saved.definition, triggers: (proposal.triggers as unknown[]) } }
      const staleApply = await apiRequest(request, 'PUT', `${WORKFLOW_DEFINITIONS_PATH}/${definitionId}`, {
        token: user.token,
        headers: { [OPTIMISTIC_LOCK_HEADER]: '2020-01-01T00:00:00.000Z' },
        data: applyBody,
      })
      expect(staleApply.status(), `apply with a stale updatedAt: ${await staleApply.text()}`).toBe(409)
      const apply = await apiRequest(request, 'PUT', `${WORKFLOW_DEFINITIONS_PATH}/${definitionId}`, {
        token: user.token,
        headers: { [OPTIMISTIC_LOCK_HEADER]: saved.updatedAt },
        data: applyBody,
      })
      expect(apply.status(), `apply the simulated triggers: ${await apply.text()}`).toBe(200)
      const applied = await simulationCall<{ decision?: { decision: string; verified: boolean | null } }>(request, user.token, 'POST', `${SIMULATIONS_PATH}/${runId}/decision`, { data: { decision: 'applied' } })
      expect(applied.status, `record the applied decision: ${applied.text}`).toBe(201)
      expect(applied.body?.decision).toEqual(expect.objectContaining({ decision: 'applied', verified: true }))

      const secondProposal = triggerProposal(workflowId, { enabled: true, triggers: [{ ...triggers[0], config: null }] })
      const second = await requestSimulation(request, user.token, { kind: TRIGGER_BACKTEST_KIND, artifactId: definitionId, proposal: secondProposal, window: { days: 30 } })
      expect(second.status, second.text).toBe(202)
      const secondRun = await waitForSimulation(request, user.token, second.body?.runId as string)
      expect(secondRun.status).toBe('completed')
      expect(cellOf(groupOf(secondRun, 'debounced:customers.deal.updated'), 'would_start').count).toBe(10)
      const current = await readWorkflowDefinition(request, user.token, definitionId)
      const differing = await apiRequest(request, 'PUT', `${WORKFLOW_DEFINITIONS_PATH}/${definitionId}`, {
        token: user.token,
        headers: { [OPTIMISTIC_LOCK_HEADER]: current.updatedAt },
        data: { enabled: true, definition: { ...current.definition, triggers: [{ ...(secondProposal.triggers as Array<Record<string, unknown>>)[0], eventPattern: 'customers.deal.created' }] } },
      })
      expect(differing.status(), await differing.text()).toBe(200)
      const unverified = await simulationCall<{ decision?: { verified: boolean | null } }>(request, user.token, 'POST', `${SIMULATIONS_PATH}/${secondRun.id}/decision`, { data: { decision: 'applied' } })
      expect(unverified.status, unverified.text).toBe(201)
      expect(unverified.body?.decision?.verified, 'what was saved differs from what was simulated').toBe(false)

      const codeDefined = await requestSimulation(request, user.token, { kind: TRIGGER_BACKTEST_KIND, artifactId: 'code:workflows.simple-approval', proposal, window: { days: 30 } })
      expect(codeDefined.status, codeDefined.text).toBe(422)
      expect(codeDefined.body?.code).toBe('not_customized')

      const outsider = await createSimulationUser(request, fixture, {
        label: 'INS-S06 outsider',
        organizationId,
        features: WORKFLOW_SIMULATOR_FEATURES.filter((feature) => !feature.startsWith('workflows.')),
      })
      const refused = await requestSimulation(request, outsider.token, { kind: TRIGGER_BACKTEST_KIND, artifactId: definitionId, proposal, window: { days: 30 } })
      expect(refused.status, refused.text).toBe(403)
      expect(refused.body?.requiredFeatures).toEqual(['workflows.definitions.view'])
      const foreign = await simulationCall(request, outsider.token, 'GET', `${SIMULATIONS_PATH}/${runId}`)
      expect(foreign.status, 'another user never reads the run').toBe(404)
    } finally {
      if (token && definitionId) {
        await apiRequest(request, 'DELETE', `${WORKFLOW_DEFINITIONS_PATH}/${encodeURIComponent(definitionId)}`, { token }).catch(() => undefined)
      }
      await cleanupSimulationFixture(request, fixture)
    }
  })
})
