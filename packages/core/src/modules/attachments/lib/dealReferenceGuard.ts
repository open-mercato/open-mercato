import type { EntityManager } from '@mikro-orm/postgresql'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import {
  lockEntityReferences,
  lockLiveEntityReferences,
  scopedLiveRecordCheck,
} from '@open-mercato/shared/lib/entities/reference-lock'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { AttachmentAssignment } from './metadata'

export const ATTACHMENT_DEAL_ENTITY_ID = 'customers:customer_deal'

const isDealLive = scopedLiveRecordCheck('customer_deals')

export type AttachmentDealReferenceScope = {
  tenantId: string
  organizationId: string
}

export function collectAttachmentDealIds(input: {
  entityId?: string | null
  recordId?: string | null
  assignments?: readonly AttachmentAssignment[] | null
}): string[] {
  const ids = new Set<string>()
  if (input.entityId === ATTACHMENT_DEAL_ENTITY_ID && input.recordId) ids.add(input.recordId)
  for (const assignment of input.assignments ?? []) {
    if (assignment.type === ATTACHMENT_DEAL_ENTITY_ID && assignment.id) ids.add(assignment.id)
  }
  return [...ids]
}

function toReferences(dealIds: readonly string[], scope: AttachmentDealReferenceScope) {
  return dealIds.map((recordId) => ({
    entityId: ATTACHMENT_DEAL_ENTITY_ID,
    recordId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }))
}

export async function lockAttachmentDealReferences(
  em: EntityManager,
  dealIds: readonly string[],
  scope: AttachmentDealReferenceScope,
): Promise<void> {
  if (dealIds.length === 0) return
  await lockEntityReferences(em, toReferences(dealIds, scope))
}

export async function lockLiveAttachmentDealReferences(
  em: EntityManager,
  dealIds: readonly string[],
  scope: AttachmentDealReferenceScope,
): Promise<void> {
  if (dealIds.length === 0) return
  const missing = await lockLiveEntityReferences(em, toReferences(dealIds, scope), isDealLive)
  if (missing.length === 0) return
  const { translate } = await resolveTranslations()
  throw notFound(translate('attachments.errors.dealNotFound', 'Deal not found.'))
}
