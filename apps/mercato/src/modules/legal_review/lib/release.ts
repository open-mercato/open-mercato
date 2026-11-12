import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { LegalMatter } from '../data/entities'
import { emitLegalReviewEvent } from '../events'
import { canReleaseFromStage } from './stages'

export type LegalReviewScope = { tenantId: string; organizationId: string }

export type LegalMatterReleaseResult = {
  matterId: string
  stage: string
  released: boolean
}

/**
 * Advances one matter to `released`.
 *
 * Idempotent on purpose: `documents.review.cleared` is a level-change signal
 * that can arrive more than once, so a matter already released (or further
 * along, in signing) is left untouched and reported with `released: false`.
 * Returns null when the matter does not exist in the scope.
 */
export async function releaseLegalMatter(
  em: EntityManager,
  scope: LegalReviewScope,
  matterId: string,
): Promise<LegalMatterReleaseResult | null> {
  const matter = await findOneWithDecryption(
    em,
    LegalMatter,
    { id: matterId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    scope,
  )
  if (!matter) return null
  if (!canReleaseFromStage(matter.stage)) {
    return { matterId: matter.id, stage: matter.stage, released: false }
  }
  matter.stage = 'released'
  matter.updatedAt = new Date()
  await em.flush()
  await emitLegalReviewEvent(
    'legal_review.matter.released',
    {
      id: matter.id,
      documentId: matter.documentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    { persistent: true },
  )
  return { matterId: matter.id, stage: matter.stage, released: true }
}

export async function findOpenMattersForDocument(
  em: EntityManager,
  scope: LegalReviewScope,
  documentId: string,
): Promise<LegalMatter[]> {
  const matters = await findWithDecryption(
    em,
    LegalMatter,
    { documentId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    scope,
  )
  return matters.filter((matter) => canReleaseFromStage(matter.stage))
}
