import type { EntityManager } from '@mikro-orm/postgresql'
import { lockLiveEntityReferences, scopedLiveRecordCheck } from '@open-mercato/shared/lib/entities/reference-lock'
import { resolveAliasedTaskEntityId } from './task-entity-aliases'

const WORKFLOW_DEAL_REFERENCE_ENTITY_ID = 'customers:customer_deal'

const isDealLive = scopedLiveRecordCheck('customer_deals')

type TaskEntityBindingReference = {
  entityType: string
  entityId: string
}

export function collectTaskDealIds(bindings: readonly TaskEntityBindingReference[]): string[] {
  const ids = new Set<string>()
  for (const binding of bindings) {
    if (binding.entityId && resolveAliasedTaskEntityId(binding.entityType) === WORKFLOW_DEAL_REFERENCE_ENTITY_ID) {
      ids.add(binding.entityId)
    }
  }
  return [...ids]
}

export async function lockTaskDealReferences(
  em: EntityManager,
  dealIds: readonly string[],
  scope: { tenantId: string; organizationId: string },
) {
  return lockLiveEntityReferences(em, dealIds.map((recordId) => ({
    entityId: WORKFLOW_DEAL_REFERENCE_ENTITY_ID,
    recordId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })), isDealLive)
}
