import type { EntityManager } from '@mikro-orm/postgresql'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import { lockLiveEntityReference, scopedLiveRecordCheck } from '@open-mercato/shared/lib/entities/reference-lock'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const STAFF_DEAL_REFERENCE_ENTITY_ID = 'customers:customer_deal'

const isDealLive = scopedLiveRecordCheck('customer_deals')

export async function lockLiveStaffDealReference(
  em: EntityManager,
  dealId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  const live = await lockLiveEntityReference(em, {
    entityId: STAFF_DEAL_REFERENCE_ENTITY_ID,
    recordId: dealId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }, isDealLive)
  if (live) return
  const { translate } = await resolveTranslations()
  throw notFound(translate('staff.timesheets.errors.dealNotFound', 'Deal not found.'))
}
