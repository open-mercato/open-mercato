import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * Upper bound on the run ids folded into the Traces "needs-review" facet. The
 * newest matching runs win; the facet is a triage view, not an export. The cap
 * applies AFTER the run-side filters, so other agents' checks never crowd out
 * the runs the caller is actually listing.
 */
export const REVIEW_REQUESTED_RUN_ID_LIMIT = 500

export type ReviewRequestedRunScope = {
  tenantId: string | null | undefined
  organizationIds: string[] | null
  createdAfter?: Date | null
  createdBefore?: Date | null
  agentId?: string | null
  status?: string | null
  resultKind?: string | null
  agentType?: string | null
  flagged?: boolean | null
}

type ReviewRequestedRunsDb = {
  agent_guardrail_checks: {
    agent_run_id: string
    tenant_id: string
    organization_id: string
    kind: string
    result: string
  }
  agent_runs: {
    id: string
    tenant_id: string
    organization_id: string
    agent_id: string
    status: string
    result_kind: string | null
    agent_type: string | null
    flagged_at: Date | null
    created_at: Date
    deleted_at: Date | null
  }
}

/**
 * Ids of runs whose `abstain_or_review` integrity rule asked for a human
 * (`warn`), restricted to runs matching the list's own run filters (agent,
 * status, created window, ...). Both tables are scoped by the CALLER's tenant
 * and organizations, never by request input: no tenant, or an empty
 * organization scope, yields nothing.
 */
export async function findReviewRequestedRunIds(
  em: EntityManager,
  scope: ReviewRequestedRunScope,
  limit: number = REVIEW_REQUESTED_RUN_ID_LIMIT,
): Promise<string[]> {
  const tenantId = scope.tenantId
  if (!tenantId) return []
  const organizationIds = scope.organizationIds
  if (Array.isArray(organizationIds) && organizationIds.length === 0) return []

  let query = em
    .getKysely<ReviewRequestedRunsDb>()
    .selectFrom('agent_guardrail_checks')
    .innerJoin('agent_runs', 'agent_runs.id', 'agent_guardrail_checks.agent_run_id')
    .select(['agent_runs.id as runId'])
    .where('agent_guardrail_checks.tenant_id', '=', tenantId)
    .where('agent_guardrail_checks.kind', '=', 'abstain_or_review')
    .where('agent_guardrail_checks.result', '=', 'warn')
    .where('agent_runs.tenant_id', '=', tenantId)
    .where('agent_runs.deleted_at', 'is', null)

  if (Array.isArray(organizationIds)) {
    query = query
      .where('agent_guardrail_checks.organization_id', 'in', organizationIds)
      .where('agent_runs.organization_id', 'in', organizationIds)
  }
  if (scope.agentId) query = query.where('agent_runs.agent_id', '=', scope.agentId)
  if (scope.status) query = query.where('agent_runs.status', '=', scope.status)
  if (scope.resultKind) query = query.where('agent_runs.result_kind', '=', scope.resultKind)
  if (scope.agentType) query = query.where('agent_runs.agent_type', '=', scope.agentType)
  if (scope.flagged) query = query.where('agent_runs.flagged_at', 'is not', null)
  if (scope.createdAfter) query = query.where('agent_runs.created_at', '>=', scope.createdAfter)
  if (scope.createdBefore) query = query.where('agent_runs.created_at', '<', scope.createdBefore)

  const rows = await query
    .groupBy(['agent_runs.id', 'agent_runs.created_at'])
    .orderBy('agent_runs.created_at', 'desc')
    .limit(limit)
    .execute()
  return rows.map((row) => row.runId)
}
