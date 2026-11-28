import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { lockLiveEntityReference, scopedLiveRecordCheck } from '@open-mercato/shared/lib/entities/reference-lock'
import type { DocumentEntityType } from '../data/validators'

export const DEAL_REFERENCE_ENTITY_ID = 'customers:customer_deal'

const isDealLive = scopedLiveRecordCheck('customer_deals')

export type DealReferenceScope = {
  tenantId: string
  organizationId: string
}

export function isDealLinkEntityType(entityType: DocumentEntityType): boolean {
  return entityType === 'deal'
}

export async function lockLiveDealReference(
  em: EntityManager,
  dealId: string,
  scope: DealReferenceScope,
): Promise<void> {
  const live = await lockLiveEntityReference(em, {
    entityId: DEAL_REFERENCE_ENTITY_ID,
    recordId: dealId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }, isDealLive)
  if (!live) {
    throw new CrudHttpError(404, { error: 'documents.links.notFound' })
  }
}
