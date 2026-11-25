import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { lockEntityReferences } from '@open-mercato/shared/lib/entities/reference-lock'
import type { DocumentEntityType } from '../data/validators'

export const DEAL_REFERENCE_ENTITY_ID = 'customers:customer_deal'

const DEAL_EXISTS_SQL = 'select 1 from customer_deals where id = ? and tenant_id = ? and organization_id = ? and deleted_at is null limit 1'

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
  await lockEntityReferences(em, [{
    entityId: DEAL_REFERENCE_ENTITY_ID,
    recordId: dealId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }])
  const rows = await em.execute(DEAL_EXISTS_SQL, [dealId, scope.tenantId, scope.organizationId])
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new CrudHttpError(404, { error: 'documents.links.notFound' })
  }
}
