import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { listEntityMetadata } from '@open-mercato/shared/lib/db/entityMetadata'
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { resolveRegisteredEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('translations').child({ component: 'cleanup' })

export const metadata = { event: 'query_index.delete_one', persistent: false }

type TranslationsCleanupDatabase = Record<string, Record<string, unknown>>

type SoftDeleteSource = {
  table: string
  idColumn: string
  deletedAtColumn: string
  tenantColumn: string | null
  organizationColumn: string | null
}

type EntityPropertyMetadata = { fieldNames?: unknown }

function isRegisteredEntityType(entityType: string): boolean {
  return Object.values(getEntityIds(false)).some((moduleEntities) =>
    Object.values(moduleEntities ?? {}).includes(entityType),
  )
}

function resolveSingleColumn(property: EntityPropertyMetadata | undefined): string | null {
  const fieldNames = property?.fieldNames
  if (!Array.isArray(fieldNames) || fieldNames.length !== 1) return null
  const column = fieldNames[0]
  return typeof column === 'string' && column ? column : null
}

function resolveSoftDeleteSource(em: EntityManager, entityType: string): SoftDeleteSource | null {
  if (!isRegisteredEntityType(entityType)) return null
  const table = resolveRegisteredEntityTableName(em, entityType)
  if (!table) return null
  const entityMetadata = listEntityMetadata(em).find((candidate) => String(candidate.tableName ?? '') === table)
  if (!entityMetadata) return null
  const properties = entityMetadata.properties as unknown as Record<string, EntityPropertyMetadata | undefined>
  const deletedAtColumn = resolveSingleColumn(properties.deletedAt)
  if (!deletedAtColumn) return null
  const primaryKeys = entityMetadata.primaryKeys ?? []
  if (primaryKeys.length !== 1) return null
  const idColumn = resolveSingleColumn(properties[String(primaryKeys[0])])
  if (!idColumn) return null
  return {
    table,
    idColumn,
    deletedAtColumn,
    tenantColumn: resolveSingleColumn(properties.tenantId),
    organizationColumn: resolveSingleColumn(properties.organizationId),
  }
}

async function isOwningRecordSoftDeleted(
  em: EntityManager,
  entityType: string,
  recordId: string,
  tenantId: string | null,
  organizationId: string | null,
): Promise<boolean> {
  const source = resolveSoftDeleteSource(em, entityType)
  if (!source) return false
  let query = em
    .getKysely<TranslationsCleanupDatabase>()
    .selectFrom(source.table)
    .select(source.deletedAtColumn)
    .where(source.idColumn, '=', recordId)
  if (source.tenantColumn) {
    query = query.where(sql<boolean>`${sql.ref(source.tenantColumn)} is not distinct from ${tenantId}`)
  }
  if (source.organizationColumn) {
    query = query.where(sql<boolean>`${sql.ref(source.organizationColumn)} is not distinct from ${organizationId}`)
  }
  const row = await query.executeTakeFirst()
  return row !== undefined && row[source.deletedAtColumn] !== null && row[source.deletedAtColumn] !== undefined
}

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
    if (await isOwningRecordSoftDeleted(em, entityType, recordId, tenantId, organizationId)) {
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
