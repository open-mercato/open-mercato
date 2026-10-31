import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { isTranslatedRecordSoftDeleted } from '@open-mercato/core/modules/translations/lib/soft-deleted-owner'

const logger = createLogger('translations').child({ component: 'cleanup' })

export const metadata = { event: 'query_index.delete_one', persistent: false }

type TranslationsCleanupDatabase = Record<string, Record<string, unknown>>

export default async function handle(
  payload: { entityType?: string; recordId?: string; organizationId?: string | null; tenantId?: string | null },
  ctx: { resolve: <T = unknown>(name: string) => T },
) {
  const entityType = String(payload?.entityType || '')
  const recordId = String(payload?.recordId || '')
  if (!entityType || !recordId) return

  const organizationId = payload?.organizationId ?? null
  const tenantId = payload?.tenantId ?? null

  let em: EntityManager
  try {
    em = ctx.resolve<EntityManager>('em')
    if (await isTranslatedRecordSoftDeleted(em, entityType, recordId, { tenantId, organizationId })) {
      logger.debug('Keeping translations of a soft-deleted record', { entityType, recordId })
      return
    }
  } catch (err) {
    logger.warn('Failed to check whether the translated record is soft-deleted; keeping its translations', { entityType, recordId, err })
    getTelemetryRuntime()?.reportError(err, {
      module: 'translations',
      code: 'translations.cleanup_soft_delete_check_failed',
      attributes: { entityType },
    })
    return
  }

  try {
    await em
      .getKysely<TranslationsCleanupDatabase>()
      .deleteFrom('entity_translations')
      .where('entity_type', '=', entityType)
      .where('entity_id', '=', recordId)
      .where(sql<boolean>`tenant_id is not distinct from ${tenantId}`)
      .where(sql<boolean>`organization_id is not distinct from ${organizationId}`)
      .execute()
  } catch (err) {
    logger.warn('Failed to delete translations', { err })
  }
}
