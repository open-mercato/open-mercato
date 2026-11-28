import { randomUUID } from 'node:crypto'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

/**
 * Fixtures for TC-AGENT-EVAL-REGRESSION-*.
 *
 * Suite runs whose agent runs carry two KNOWN agent versions, with known
 * per-case verdicts, cannot be produced through the public API without a live
 * model, so the rows are seeded directly — the dbFixtures precedent of the
 * eval report specs. Every row a spec creates is hard-deleted in cleanup.
 */

export type RegressionScope = { tenantId: string; organizationId: string }

export type SeedCaseRun = {
  caseId: string
  status: 'passed' | 'failed' | 'error' | 'skipped'
  verdicts: Record<string, boolean | null>
}

export type SeedSuiteRun = {
  agentDefinitionId: string
  status: 'completed' | 'running'
  passScore: number | null
  evalSetVersion: string | null
  agentVersion: string | null
  createdAt: Date
  caseRuns: SeedCaseRun[]
}

export type RegressionFixtureIds = {
  suiteRunIds: string[]
  caseIds: string[]
  agentRunIds: string[]
}

export function emptyFixtureIds(): RegressionFixtureIds {
  return { suiteRunIds: [], caseIds: [], agentRunIds: [] }
}

export async function insertEvalCase(
  scope: RegressionScope,
  agentDefinitionId: string,
  name: string,
  ids: RegressionFixtureIds,
): Promise<string> {
  const id = randomUUID()
  await withClient(async (client) => {
    await client.query(
      `insert into agent_eval_cases
         (id, tenant_id, organization_id, source_type, source_id, agent_definition_id, name, input, status, created_at, updated_at)
       values ($1, $2, $3, 'golden_run', $4, $5, $6, '{}'::jsonb, 'approved', now(), now())`,
      [id, scope.tenantId, scope.organizationId, randomUUID(), agentDefinitionId, name],
    )
  })
  ids.caseIds.push(id)
  return id
}

export async function insertSuiteRun(
  scope: RegressionScope,
  seed: SeedSuiteRun,
  ids: RegressionFixtureIds,
): Promise<string> {
  const suiteRunId = randomUUID()
  ids.suiteRunIds.push(suiteRunId)
  await withClient(async (client) => {
    await client.query(
      `insert into agent_eval_suite_runs
         (id, tenant_id, organization_id, agent_definition_id, trigger, status, outcome, judge_may_gate, repeat_count,
          case_count, error_count, eval_set_version, pass_score, started_at, finished_at, created_at)
       values ($1, $2, $3, $4, 'manual', $5, $6, false, 1, $7, 0, $8, $9, $10, $11, $10)`,
      [
        suiteRunId,
        scope.tenantId,
        scope.organizationId,
        seed.agentDefinitionId,
        seed.status,
        seed.status === 'completed' ? 'advisory' : null,
        seed.caseRuns.length,
        seed.evalSetVersion,
        seed.passScore,
        seed.createdAt,
        seed.status === 'completed' ? new Date(seed.createdAt.getTime() + 60_000) : null,
      ],
    )
    for (const [index, caseRun] of seed.caseRuns.entries()) {
      const agentRunId = randomUUID()
      const caseRunId = randomUUID()
      ids.agentRunIds.push(agentRunId)
      const createdAt = new Date(seed.createdAt.getTime() + index * 1000)
      await client.query(
        `insert into agent_runs
           (id, tenant_id, organization_id, agent_id, source, agent_version, status, input, created_at, updated_at)
         values ($1, $2, $3, $4, 'eval', $5, 'completed', '{}'::jsonb, $6, $6)`,
        [agentRunId, scope.tenantId, scope.organizationId, seed.agentDefinitionId, seed.agentVersion, createdAt],
      )
      await client.query(
        `insert into agent_eval_case_runs
           (id, tenant_id, organization_id, suite_run_id, eval_case_id, agent_run_id, trial_index, status, score, passed, created_at)
         values ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10)`,
        [
          caseRunId,
          scope.tenantId,
          scope.organizationId,
          suiteRunId,
          caseRun.caseId,
          agentRunId,
          caseRun.status,
          caseRun.status === 'passed' ? 1 : 0,
          caseRun.status === 'passed' ? true : caseRun.status === 'failed' ? false : null,
          createdAt,
        ],
      )
      for (const [assertionKey, passed] of Object.entries(caseRun.verdicts)) {
        await client.query(
          `insert into agent_eval_results
             (id, tenant_id, organization_id, agent_run_id, assertion_id, assertion_key, eval_case_run_id, passed, severity, evaluated_at, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'gate', $9, $9)`,
          [randomUUID(), scope.tenantId, scope.organizationId, agentRunId, randomUUID(), assertionKey, caseRunId, passed, createdAt],
        )
      }
    }
  })
  return suiteRunId
}

export async function deleteRegressionFixtures(ids: RegressionFixtureIds): Promise<void> {
  await withClient(async (client) => {
    if (ids.suiteRunIds.length) {
      await client.query(
        `delete from agent_eval_results
          where eval_case_run_id in (select id from agent_eval_case_runs where suite_run_id = any($1::uuid[]))`,
        [ids.suiteRunIds],
      )
      await client.query('delete from agent_eval_case_runs where suite_run_id = any($1::uuid[])', [ids.suiteRunIds])
      await client.query('delete from agent_eval_suite_runs where id = any($1::uuid[])', [ids.suiteRunIds])
    }
    if (ids.agentRunIds.length) {
      await client.query('delete from agent_runs where id = any($1::uuid[])', [ids.agentRunIds])
    }
    if (ids.caseIds.length) {
      await client.query('delete from agent_eval_cases where id = any($1::uuid[])', [ids.caseIds])
    }
  })
}
