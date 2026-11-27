import type { EntityManager } from '@mikro-orm/postgresql'
import type { EvalScope } from '../evalReplayService'

type SuiteAgentVersionsDb = {
  agent_eval_case_runs: {
    suite_run_id: string
    agent_run_id: string | null
    tenant_id: string
    organization_id: string
  }
  agent_runs: {
    id: string
    agent_version: string | null
    tenant_id: string
    organization_id: string
  }
}

/**
 * The agent version(s) each suite run executed, read from the agent runs its
 * case runs produced (`agent_eval_suite_runs` carries no version column: AO
 * migrations are squash-only). One DISTINCT join, so the result is at most
 * suites × versions rows however many trials the suites hold. Both tables are
 * scoped to the caller's tenant and organization. `null` stands for agent runs
 * that predate version stamping; a suite with no agent run gets an empty list.
 */
export async function loadSuiteAgentVersions(
  em: EntityManager,
  scope: EvalScope,
  suiteRunIds: ReadonlyArray<string>,
): Promise<Map<string, Array<string | null>>> {
  const versions = new Map<string, Array<string | null>>()
  for (const id of suiteRunIds) versions.set(id, [])
  if (!suiteRunIds.length) return versions

  const rows = await em
    .getKysely<SuiteAgentVersionsDb>()
    .selectFrom('agent_eval_case_runs')
    .innerJoin('agent_runs', 'agent_runs.id', 'agent_eval_case_runs.agent_run_id')
    .select(['agent_eval_case_runs.suite_run_id as suiteRunId', 'agent_runs.agent_version as agentVersion'])
    .distinct()
    .where('agent_eval_case_runs.suite_run_id', 'in', [...suiteRunIds])
    .where('agent_eval_case_runs.tenant_id', '=', scope.tenantId)
    .where('agent_eval_case_runs.organization_id', '=', scope.organizationId)
    .where('agent_runs.tenant_id', '=', scope.tenantId)
    .where('agent_runs.organization_id', '=', scope.organizationId)
    .execute()

  for (const row of rows) {
    const bucket = versions.get(row.suiteRunId)
    if (bucket && !bucket.includes(row.agentVersion)) bucket.push(row.agentVersion)
  }
  for (const bucket of versions.values()) {
    bucket.sort((left, right) => (left ?? '').localeCompare(right ?? ''))
  }
  return versions
}
