import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentGuardrailCheck } from '../../../data/entities'

/**
 * Upper bound on the run ids folded into the Traces "needs-review" facet. The
 * newest runs win; the facet is a triage view, not an export.
 */
export const REVIEW_REQUESTED_RUN_ID_LIMIT = 500

export type ReviewRequestedRunScope = {
  tenantId: string | null | undefined
  organizationIds: string[] | null
  createdAfter?: Date | null
}

/**
 * Ids of runs whose `abstain_or_review` integrity rule asked for a human
 * (`warn`). Scoped by the CALLER's tenant and organizations, never by request
 * input: no tenant, or an empty organization scope, yields nothing.
 */
export async function findReviewRequestedRunIds(
  em: EntityManager,
  scope: ReviewRequestedRunScope,
  limit: number = REVIEW_REQUESTED_RUN_ID_LIMIT,
): Promise<string[]> {
  const tenantId = scope.tenantId
  if (!tenantId) return []
  if (Array.isArray(scope.organizationIds) && scope.organizationIds.length === 0) return []

  const where: Record<string, unknown> = {
    tenantId,
    kind: 'abstain_or_review',
    result: 'warn',
  }
  if (Array.isArray(scope.organizationIds)) where.organizationId = { $in: scope.organizationIds }
  if (scope.createdAfter) where.createdAt = { $gte: scope.createdAfter }

  const rows = await findWithDecryption(
    em,
    AgentGuardrailCheck,
    where,
    { fields: ['agentRunId'], orderBy: { createdAt: 'desc' }, limit },
    { tenantId, organizationId: null },
  )
  return Array.from(new Set(rows.map((row) => row.agentRunId)))
}
