import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

/**
 * Fixtures for the TC-AGENT-EVAL-REPORT-* specs.
 *
 * Eval cases and the completed suite run are created through the public API.
 * A suite run that is still `running` (for the 409 contract) or that belongs to
 * another organization (for the 404 contract) cannot be produced through any
 * public API deterministically, so those rows are seeded directly — the same
 * dbFixtures precedent as agentPerfFixtures. Suite runs are append-only, so
 * cleanup hard-deletes every row a spec created, including the case runs,
 * results and agent runs an API-started replay produced.
 */

export type EvalSuiteRunSeed = {
  tenantId: string
  organizationId: string
  agentDefinitionId: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
}

export async function firstRegisteredAgentId(request: APIRequestContext, token: string): Promise<string> {
  const response = await apiRequest(request, 'GET', '/api/agent_orchestrator/agents', { token })
  expect(response.status(), await response.text()).toBe(200)
  const agentId = (await readJsonSafe<{ items?: Array<{ id?: string }> }>(response))?.items?.[0]?.id ?? ''
  expect(agentId, 'at least one registered agent is required').toBeTruthy()
  return agentId
}

export async function createApprovedEvalCase(
  request: APIRequestContext,
  token: string,
  agentDefinitionId: string,
  name: string,
): Promise<string> {
  const createRes = await apiRequest(request, 'POST', '/api/agent_orchestrator/eval-cases', {
    token,
    data: { agentDefinitionId, name, input: { question: `${name} input` } },
  })
  expect(createRes.status(), await createRes.text()).toBe(201)
  const evalCaseId = (await readJsonSafe<{ id?: string }>(createRes))?.id ?? ''
  expect(evalCaseId, 'eval case create must return an id').toBeTruthy()
  const approveRes = await apiRequest(
    request,
    'POST',
    `/api/agent_orchestrator/eval-cases/${encodeURIComponent(evalCaseId)}/approve`,
    { token },
  )
  expect(approveRes.status(), await approveRes.text()).toBe(200)
  return evalCaseId
}

export async function startEvalRun(
  request: APIRequestContext,
  token: string,
  agentDefinitionId: string,
  evalCaseIds: string[],
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/agent_orchestrator/eval-runs', {
    token,
    data: { agentDefinitionId, evalCaseIds, repeatCount: 1, judgeMayGate: false },
  })
  expect(response.status(), await response.text()).toBe(200)
  const suiteRunId = (await readJsonSafe<{ suiteRunId?: string }>(response))?.suiteRunId ?? ''
  expect(suiteRunId, 'a synchronous eval run must return its suite run id').toBeTruthy()
  return suiteRunId
}

export async function insertEvalSuiteRunFixture(seed: EvalSuiteRunSeed): Promise<string> {
  const id = randomUUID()
  await withClient(async (client) => {
    await client.query(
      `insert into agent_eval_suite_runs
         (id, tenant_id, organization_id, agent_definition_id, trigger, status, judge_may_gate, repeat_count, case_count, error_count, started_at, created_at)
       values ($1, $2, $3, $4, 'manual', $5, false, 1, 0, 0, now(), now())`,
      [id, seed.tenantId, seed.organizationId, seed.agentDefinitionId, seed.status],
    )
  })
  return id
}

export async function deleteEvalSuiteRunsByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await withClient(async (client) => {
    await client.query(
      `delete from agent_eval_results
        where eval_case_run_id in (select id from agent_eval_case_runs where suite_run_id = any($1::uuid[]))
           or agent_run_id in (select agent_run_id from agent_eval_case_runs where suite_run_id = any($1::uuid[]) and agent_run_id is not null)`,
      [ids],
    )
    await client.query(
      `delete from agent_runs
        where id in (select agent_run_id from agent_eval_case_runs where suite_run_id = any($1::uuid[]) and agent_run_id is not null)`,
      [ids],
    )
    await client.query('delete from agent_eval_case_runs where suite_run_id = any($1::uuid[])', [ids])
    await client.query('delete from agent_eval_suite_runs where id = any($1::uuid[])', [ids])
  })
}

export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}
