import type { EntityManager } from '@mikro-orm/postgresql'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import {
  lockEntityReferences,
  lockLiveEntityReferences,
  scopedLiveRecordCheck,
} from '@open-mercato/shared/lib/entities/reference-lock'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const MESSAGE_DEAL_REFERENCE_ENTITY_ID = 'customers:customer_deal'
export const MESSAGE_DEAL_OBJECT_MODULE = 'customers'
export const MESSAGE_DEAL_OBJECT_TYPE = 'deal'

const isDealLive = scopedLiveRecordCheck('customer_deals')

export type MessageObjectReference = {
  entityModule: string
  entityType: string
  entityId: string
}

export type MessageDealReferenceScope = {
  tenantId: string
  organizationId: string | null | undefined
}

export function collectMessageDealIds(objects: readonly MessageObjectReference[] | null | undefined): string[] {
  const ids = new Set<string>()
  for (const object of objects ?? []) {
    if (object.entityModule === MESSAGE_DEAL_OBJECT_MODULE && object.entityType === MESSAGE_DEAL_OBJECT_TYPE && object.entityId) {
      ids.add(object.entityId)
    }
  }
  return [...ids]
}

function toReferences(dealIds: readonly string[], scope: MessageDealReferenceScope) {
  if (!scope.organizationId || dealIds.length === 0) return []
  const organizationId = scope.organizationId
  return dealIds.map((recordId) => ({
    entityId: MESSAGE_DEAL_REFERENCE_ENTITY_ID,
    recordId,
    tenantId: scope.tenantId,
    organizationId,
  }))
}

export async function lockMessageDealReferences(
  em: EntityManager,
  dealIds: readonly string[],
  scope: MessageDealReferenceScope,
): Promise<void> {
  const references = toReferences(dealIds, scope)
  if (references.length === 0) return
  await lockEntityReferences(em, references)
}

export async function lockLiveMessageDealReferences(
  em: EntityManager,
  dealIds: readonly string[],
  scope: MessageDealReferenceScope,
): Promise<void> {
  const references = toReferences(dealIds, scope)
  if (references.length === 0) return
  const missing = await lockLiveEntityReferences(em, references, isDealLive)
  if (missing.length === 0) return
  const { translate } = await resolveTranslations()
  throw notFound(translate('messages.errors.dealNotFound', 'Deal not found.'))
}
