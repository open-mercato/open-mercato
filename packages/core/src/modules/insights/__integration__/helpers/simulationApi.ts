import { expect, type APIRequestContext } from '@playwright/test'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import { createQaDeal, updateQaDeal, uniqueSuffix } from './explainApi'
import { OPTIMISTIC_LOCK_HEADER, putXraySettings } from './xrayApi'
import {
  cleanupXrayAnalyticsFixture,
  createXrayAnalyticsFixture,
  createXrayOrganization,
  createXrayRole,
  createXrayUser,
  xrayCall,
  type XrayAnalyticsFixture,
  type XrayHttpResult,
} from './xrayAnalyticsApi'

export { OPTIMISTIC_LOCK_HEADER, uniqueSuffix }

export const SIMULATIONS_PATH = '/api/insights/simulations'
export const SIMULATION_QUEUE = 'insights-simulation'
export const RULES_PATH = '/api/business_rules/rules'
export const RULE_BACKTEST_KIND = 'business_rules.rule_backtest'
export const TRIGGER_BACKTEST_KIND = 'workflows.trigger_backtest'
export const WORKFLOW_DEFINITIONS_PATH = '/api/workflows/definitions'

/** What a rule backtest needs: the simulator, the rule definitions and logs, and the targeted record type. */
export const SIMULATOR_FEATURES = [
  'insights.simulator.view',
  'insights.simulator.run',
  'business_rules.view',
  'business_rules.manage',
  'business_rules.view_logs',
  'customers.deals.view',
  'customers.deals.manage',
  'progress.view',
  'progress.cancel',
]

/** What a trigger backtest of deal events needs, plus authoring and applying the definition. */
export const WORKFLOW_SIMULATOR_FEATURES = [
  'insights.simulator.view',
  'insights.simulator.run',
  'workflows.definitions.view',
  'workflows.definitions.create',
  'workflows.definitions.edit',
  'workflows.definitions.delete',
  'customers.deals.view',
  'customers.deals.manage',
  'progress.view',
]

const RUN_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 1000

export type SimulationCell = { key: string; count: number | null; suppressed: 'below_k' | 'complementary' | null; samples: Array<{ id: string; href: string | null }> }

export type SimulationGroup = { key: string; total: number | null; suppressed: boolean; cells: SimulationCell[]; warnings: string[]; flags: string[] }

export type SimulationRunBody = {
  id: string
  kind: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progressJobId: string | null
  fidelity: string | null
  errorCode: string | null
  artifactId: string | null
  proposal: Record<string, unknown>
  result: { k: number; truncated: boolean; groups: SimulationGroup[] } | null
  coverage: Record<string, number> | null
  caveats: string[]
  decisions: Array<{ decision: string; verified: boolean | null; artifactId: string | null }>
  applyHref: string | null
  canDecide: boolean
}

export type SimulationFixture = XrayAnalyticsFixture & { simulationOrganizationIds: string[] }

export function createSimulationFixture(): SimulationFixture {
  return { ...createXrayAnalyticsFixture(), simulationOrganizationIds: [] }
}

/** A fresh organization of the admin's tenant with the X-Ray k-anonymity the simulator applies set to 5. */
export async function createSimulationOrganization(request: APIRequestContext, fixture: SimulationFixture, label: string): Promise<string> {
  const organizationId = await createXrayOrganization(request, fixture, label)
  fixture.simulationOrganizationIds.push(organizationId)
  const settings = await putXraySettings(request, fixture.adminToken as string, { kAnonymity: 5, debounceSeconds: 0 }, { selectedOrgId: organizationId })
  expect(settings.status, `PUT X-Ray settings (k-anonymity) of the fixture organization: ${settings.text}`).toBe(200)
  return organizationId
}

/** A user whose home organization is `organizationId`, holding exactly `features` there (and in `organizations`, when given). */
export async function createSimulationUser(
  request: APIRequestContext,
  fixture: SimulationFixture,
  input: { label: string; organizationId: string; features?: string[]; organizations?: string[] },
): Promise<{ token: string; userId: string }> {
  const organizations = input.organizations ?? [input.organizationId]
  const roleId = await createXrayRole(request, fixture, { label: input.label, features: input.features ?? SIMULATOR_FEATURES, organizations })
  const user = await createXrayUser(request, fixture, { label: input.label, organizationId: input.organizationId, roleId })
  return { token: user.token, userId: user.userId }
}

export async function simulationCall<TBody = Record<string, unknown>>(
  request: APIRequestContext,
  token: string,
  method: 'GET' | 'POST',
  path: string,
  options: { selectedOrgId?: string; data?: unknown } = {},
): Promise<XrayHttpResult<TBody>> {
  return xrayCall<TBody>(request, token, method, path, options)
}

export function ruleDefinition(stamp: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ruleId: `QA_SIM_${stamp}`.slice(0, 50),
    ruleName: `QA simulation ${stamp}`,
    ruleType: 'ACTION',
    entityType: 'customers.deal',
    eventType: 'updated',
    conditionExpression: { field: 'status', operator: '=', value: 'won' },
    successActions: [{ type: 'LOG', config: { message: 'QA simulation success' } }],
    failureActions: [{ type: 'LOG', config: { message: 'QA simulation failure' } }],
    enabled: true,
    priority: 100,
    ...overrides,
  }
}

export async function createRule(request: APIRequestContext, token: string, data: Record<string, unknown>): Promise<string> {
  const created = await simulationCall<{ id?: string }>(request, token, 'POST', RULES_PATH, { data })
  expect(created.status, `POST ${RULES_PATH}: ${created.text}`).toBe(201)
  expect(created.body?.id).toBeTruthy()
  return created.body?.id as string
}

export async function readRuleUpdatedAt(request: APIRequestContext, token: string, ruleId: string): Promise<string> {
  const read = await simulationCall<{ updatedAt?: string; updated_at?: string }>(request, token, 'GET', `${RULES_PATH}/${ruleId}`)
  expect(read.status, `GET ${RULES_PATH}/${ruleId}: ${read.text}`).toBe(200)
  const updatedAt = read.body?.updatedAt ?? read.body?.updated_at
  expect(updatedAt, 'the rule exposes updatedAt').toBeTruthy()
  return updatedAt as string
}

/** Creates `count` deals in the user's organization and updates each once (title only: no won/lost lifecycle event). */
export async function seedUpdatedDeals(request: APIRequestContext, token: string, fixture: SimulationFixture, organizationId: string, count: number, label: string): Promise<string[]> {
  const ids: string[] = []
  for (let index = 0; index < count; index += 1) {
    const dealId = await createQaDeal(request, token, { title: `QA ${label} ${index} ${uniqueSuffix()}`, status: 'open' })
    fixture.deals.push({ id: dealId, organizationId })
    ids.push(dealId)
    await updateQaDeal(request, token, dealId, { title: `QA ${label} ${index} updated ${uniqueSuffix()}` })
  }
  await drainIntegrationQueue('events')
  return ids
}

export async function requestSimulation(
  request: APIRequestContext,
  token: string,
  body: Record<string, unknown>,
  options: { selectedOrgId?: string } = {},
): Promise<XrayHttpResult<{ ok?: boolean; runId?: string; progressJobId?: string | null; status?: string; deduplicated?: boolean; code?: string; error?: string; issues?: Array<{ path: string; message: string }>; reason?: string; requiredFeatures?: string[] }>> {
  return simulationCall(request, token, 'POST', SIMULATIONS_PATH, { ...options, data: body })
}

export async function readSimulation(request: APIRequestContext, token: string, runId: string, options: { selectedOrgId?: string } = {}): Promise<XrayHttpResult<{ ok?: boolean; result?: SimulationRunBody; code?: string; error?: string }>> {
  return simulationCall(request, token, 'GET', `${SIMULATIONS_PATH}/${runId}`, options)
}

/** Drains the simulation queue in the app context until the run is terminal. */
export async function waitForSimulation(request: APIRequestContext, token: string, runId: string, options: { selectedOrgId?: string } = {}): Promise<SimulationRunBody> {
  const deadline = Date.now() + RUN_TIMEOUT_MS
  let last: string | null = null
  while (Date.now() < deadline) {
    await drainIntegrationQueue(SIMULATION_QUEUE)
    const read = await readSimulation(request, token, runId, options)
    expect(read.status, `GET ${SIMULATIONS_PATH}/${runId}: ${read.text}`).toBe(200)
    const run = read.body?.result as SimulationRunBody
    last = run.status
    if (run.status !== 'queued' && run.status !== 'running') return run
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`[internal] Simulation ${runId} did not finish (last status: ${last})`)
}

export function groupOf(run: SimulationRunBody, key: string): SimulationGroup {
  const group = run.result?.groups.find((entry) => entry.key === key)
  expect(group, `result group ${key}`).toBeTruthy()
  return group as SimulationGroup
}

export function cellOf(group: SimulationGroup, key: string): SimulationCell {
  const cell = group.cells.find((entry) => entry.key === key)
  expect(cell, `cell ${key} of ${group.key}`).toBeTruthy()
  return cell as SimulationCell
}

/**
 * Holds the tenant's simulation slice lock (the lock every slice of the tenant takes) while `run`
 * executes, so runs of the tenant stay active deterministically even though queue workers run.
 */
export async function withSimulationSlicesPaused<T>(tenantId: string, run: () => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [`insights.simulation.slice:${tenantId}`])
    try {
      return await run()
    } finally {
      await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [`insights.simulation.slice:${tenantId}`])
    }
  })
}

/** Active runs owned by `userId` (DB fixture rows) so the per-user limit is reached without racing workers. */
export async function insertActiveRuns(input: { tenantId: string; organizationId: string; userId: string; count: number }): Promise<string[]> {
  return withClient(async (client) => {
    const ids: string[] = []
    for (let index = 0; index < input.count; index += 1) {
      const result = await client.query<{ id: string }>(
        `insert into insights_simulation_runs
           (id, tenant_id, organization_id, kind, status, requested_by_user_id, input_json, inputs_hash, artifact_kind,
            proposal_fingerprint, window_from, window_to, budgets_json, engine_version, contribution_version,
            created_at, expires_at, updated_at)
         values (gen_random_uuid(), $1, $2, $3, 'queued', $4, '{}'::jsonb, $5, 'business_rules.rule', 'fixture',
                 now() - interval '1 day', now(), '{}'::jsonb, 1, 1, now(), now() + interval '1 day', now())
         returning id`,
        [input.tenantId, input.organizationId, RULE_BACKTEST_KIND, input.userId, `fixture-${uniqueSuffix()}-${index}`],
      )
      ids.push(result.rows[0].id)
    }
    return ids
  })
}

export async function readProgressJob(runProgressJobId: string): Promise<{ job_type: string; name: string; description: string | null; status: string; meta: unknown; result_summary: unknown; total_count: number | null } | null> {
  return withClient(async (client) => {
    const result = await client.query<{ job_type: string; name: string; description: string | null; status: string; meta: unknown; result_summary: unknown; total_count: number | null }>(
      'select job_type, name, description, status, meta, result_summary, total_count from progress_jobs where id = $1',
      [runProgressJobId],
    )
    return result.rows[0] ?? null
  })
}

/** A ProgressJob cancellation requested by another path than the simulator (DB fixture: the platform's own cancellation flag). */
export async function requestProgressJobCancellation(progressJobId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query('update progress_jobs set cancel_requested_at = now(), updated_at = now() where id = $1', [progressJobId])
  })
}

export type TriggerFixture = {
  triggerId: string
  name: string
  eventPattern: string
  enabled?: boolean
  priority?: number
  config?: Record<string, unknown> | null
}

/** A minimal START → END workflow definition carrying `triggers`. */
export function workflowDefinitionPayload(workflowId: string, input: { enabled: boolean; triggers: TriggerFixture[] }): Record<string, unknown> {
  return {
    workflowId,
    workflowName: `QA trigger simulation ${workflowId}`,
    version: 1,
    enabled: input.enabled,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [{ transitionId: 'start-to-end', fromStepId: 'start', toStepId: 'end', trigger: 'auto' }],
      triggers: input.triggers.map((trigger) => ({ enabled: true, priority: 0, ...trigger })),
    },
  }
}

/** The trigger backtest proposal the workflow editor submits for a definition (`workflows.trigger_backtest`). */
export function triggerProposal(workflowId: string, input: { enabled: boolean; triggers: TriggerFixture[]; version?: number }): Record<string, unknown> {
  return {
    workflowId,
    version: input.version ?? 1,
    enabled: input.enabled,
    triggers: input.triggers.map((trigger) => ({ enabled: true, priority: 0, ...trigger })),
    startPreConditions: [],
  }
}

export async function readWorkflowDefinition(request: APIRequestContext, token: string, definitionId: string): Promise<{ updatedAt: string; definition: Record<string, unknown> }> {
  const read = await simulationCall<{ data?: { updatedAt?: string; definition?: Record<string, unknown> } }>(request, token, 'GET', `${WORKFLOW_DEFINITIONS_PATH}/${definitionId}`)
  expect(read.status, `GET ${WORKFLOW_DEFINITIONS_PATH}/${definitionId}: ${read.text}`).toBe(200)
  expect(read.body?.data?.updatedAt, 'the definition exposes updatedAt').toBeTruthy()
  return { updatedAt: read.body?.data?.updatedAt as string, definition: read.body?.data?.definition ?? {} }
}

export async function countWorkflowInstances(organizationId: string, workflowId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: number }>(
      'select count(*)::int as count from workflow_instances where organization_id = $1 and workflow_id = $2',
      [organizationId, workflowId],
    )
    return result.rows[0]?.count ?? 0
  })
}

/** Removes runs, decisions, progress jobs, rule logs, rules and workflow rows of the fixture organizations, then the rest of the fixture. */
export async function cleanupSimulationFixture(request: APIRequestContext, fixture: SimulationFixture): Promise<void> {
  for (const organizationId of fixture.simulationOrganizationIds) {
    await withClient(async (client) => {
      await client.query('delete from insights_simulation_decisions where organization_id = $1', [organizationId])
      await client.query('delete from insights_simulation_runs where organization_id = $1', [organizationId])
      await client.query(`delete from progress_jobs where organization_id = $1 and job_type = 'insights.simulation'`, [organizationId])
      await client.query('delete from rule_execution_logs where organization_id = $1', [organizationId])
      await client.query('delete from business_rules where organization_id = $1', [organizationId])
      await client.query('delete from workflow_instances where organization_id = $1', [organizationId])
      await client.query('delete from workflow_definitions where organization_id = $1', [organizationId])
    }).catch(() => undefined)
  }
  await cleanupXrayAnalyticsFixture(request, fixture)
}
