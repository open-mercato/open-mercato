import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { listEntityMetadata } from '@open-mercato/shared/lib/db/entityMetadata'
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { resolveRegisteredEntityTableName } from '@open-mercato/shared/lib/query/engine'

const logger = createLogger('translations').child({ component: 'cleanup' })

export const metadata = { event: 'query_index.delete_one', persistent: false }

type OwningRecordDatabase = Record<string, Record<string, unknown>>

type SoftDeleteSource = { table: string; deletedAtColumn: string }

function isRegisteredEntityType(entityType: string): boolean {
  return Object.values(getEntityIds(false)).some((moduleEntities) =>
    Object.values(moduleEntities ?? {}).includes(entityType),
  )
}

function resolveSoftDeleteSource(em: EntityManager, entityType: string): SoftDeleteSource | null {
  if (!isRegisteredEntityType(entityType)) return null
  const table = resolveRegisteredEntityTableName(em, entityType)
  if (!table) return null
  const entityMetadata = listEntityMetadata(em).find((candidate) => String(candidate.tableName ?? '') === table)
  const fieldNames = entityMetadata?.properties?.deletedAt?.fieldNames
  const deletedAtColumn = Array.isArray(fieldNames) && fieldNames.length === 1 ? fieldNames[0] : null
  if (typeof deletedAtColumn !== 'string' || !deletedAtColumn) return null
  return { table, deletedAtColumn }
}

async function isOwningRecordSoftDeleted(
  em: EntityManager,
  entityType: string,
  recordId: string,
): Promise<boolean> {
  const source = resolveSoftDeleteSource(em, entityType)
  if (!source) return false
  const row = await em
    .getKysely<OwningRecordDatabase>()
    .selectFrom(source.table)
    .select(source.deletedAtColumn)
    .where('id', '=', recordId)
    .executeTakeFirst()
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

  try {
    const em = ctx.resolve<EntityManager>('em')
    const db = em.getKysely<any>() as any
    if (await isOwningRecordSoftDeleted(em, entityType, recordId)) {
      logger.debug('Keeping translations of a soft-deleted record', { entityType, recordId })
      return
    }
    await db
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
