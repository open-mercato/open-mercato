import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { LegalMatter } from '../data/entities'
import { NDA_REVIEW_WORKFLOW_ID } from './constants'
import { buildNdaReviewCorrelationKey } from './ndaReviewWorkflow'
import type { LegalReviewScope } from './release'

export const DEFAULT_NDA_PLAYBOOK_CODE = 'nda-standard'

export const ACTIVE_WORKFLOW_STATUSES = ['RUNNING', 'PAUSED', 'WAITING_FOR_ACTIVITIES'] as const

export type StartNdaReviewRun = (input: {
  workflowId: string
  correlationKey: string
  initialContext: Record<string, unknown>
  initiatedBy: string | null
  scope: LegalReviewScope
}) => Promise<{ id: string }>

export type StartNdaReviewResult =
  | { started: true; instanceId: string; correlationKey: string }
  | { started: false; reason: 'matter_not_found' | 'already_running' }

export async function hasActiveNdaReviewRun(
  em: EntityManager,
  scope: LegalReviewScope,
  correlationKey: string,
): Promise<boolean> {
  const count = await em.count(WorkflowInstance, {
    correlationKey,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: { $in: [...ACTIVE_WORKFLOW_STATUSES] },
    deletedAt: null,
  })
  return count > 0
}

/**
 * Starts the NDA review run for a freshly created matter and moves the matter
 * from `requested` to `review`. Skips when a run with the same correlation key
 * is already active, so a replayed `legal_review.matter.created` is harmless.
 */
export async function startNdaReviewForMatter(
  em: EntityManager,
  scope: LegalReviewScope,
  matterId: string,
  startRun: StartNdaReviewRun,
): Promise<StartNdaReviewResult> {
  const matter = await findOneWithDecryption(
    em,
    LegalMatter,
    { id: matterId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    scope,
  )
  if (!matter) return { started: false, reason: 'matter_not_found' }

  const correlationKey = buildNdaReviewCorrelationKey(matter.documentId)
  if (await hasActiveNdaReviewRun(em, scope, correlationKey)) {
    return { started: false, reason: 'already_running' }
  }

  const instance = await startRun({
    workflowId: NDA_REVIEW_WORKFLOW_ID,
    correlationKey,
    initialContext: { documentId: matter.documentId, playbookCode: DEFAULT_NDA_PLAYBOOK_CODE },
    initiatedBy: matter.requestedByUserId ?? null,
    scope,
  })

  if (matter.stage === 'requested') {
    matter.stage = 'review'
    matter.updatedAt = new Date()
    await em.flush()
  }

  return { started: true, instanceId: instance.id, correlationKey }
}
