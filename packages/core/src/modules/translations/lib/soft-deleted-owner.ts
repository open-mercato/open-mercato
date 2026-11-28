import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { listEntityMetadata } from '@open-mercato/shared/lib/db/entityMetadata'
import {
  QueryIndexScopeError,
  resolveQueryIndexSourceMetadata,
  type QueryIndexSourceMetadata,
} from '@open-mercato/core/modules/query_index/lib/subscriber-scope'

type OwnerLookupDatabase = Record<string, Record<string, unknown>>

type SoftDeleteSource = QueryIndexSourceMetadata & {
  idColumn: string
  deletedAtColumn: string
}

/** Keyed by the owning entity's logical `entityId:fieldKey` pair, not CustomFieldDef's UUID primary key. */
export const FIELD_DEFINITION_TYPE = 'entities:custom_field_def'

type EntityPropertyMetadata = { fieldNames?: unknown }

export type TranslatedRecordScope = {
  tenantId: string | null
  organizationId?: string | null
}

function resolveSingleColumn(property: EntityPropertyMetadata | undefined): string | null {
  const fieldNames = property?.fieldNames
  if (!Array.isArray(fieldNames) || fieldNames.length !== 1) return null
  const column = fieldNames[0]
  return typeof column === 'string' && column ? column : null
}

function resolveSourceMetadata(em: EntityManager, entityType: string): QueryIndexSourceMetadata | null {
  try {
    return resolveQueryIndexSourceMetadata(em, entityType)
  } catch (err) {
    if (err instanceof QueryIndexScopeError) return null
    throw err
  }
}

function resolveSoftDeleteSource(em: EntityManager, entityType: string): SoftDeleteSource | null {
  const source = resolveSourceMetadata(em, entityType)
  if (!source) return null
  const tableName = source.tableName ?? source.table
  const entityMetadata = listEntityMetadata(em).find((candidate) =>
    String(candidate.tableName ?? '') === tableName
    && (candidate.schema && candidate.schema !== '*' ? candidate.schema : undefined) === source.schema,
  )
  if (!entityMetadata) return null
  const properties = entityMetadata.properties as unknown as Record<string, EntityPropertyMetadata | undefined>
  const deletedAtColumn = resolveSingleColumn(properties.deletedAt)
  if (!deletedAtColumn) return null
  const primaryKeys = entityMetadata.primaryKeys ?? []
  if (primaryKeys.length !== 1) return null
  const idColumn = resolveSingleColumn(properties[String(primaryKeys[0])])
  if (!idColumn) return null
  return { ...source, idColumn, deletedAtColumn }
}

async function isFieldDefinitionTranslationSoftDeleted(
  em: EntityManager,
  recordId: string,
  scope: TranslatedRecordScope,
): Promise<boolean> {
  const separator = recordId.lastIndexOf(':')
  if (separator <= 0 || separator === recordId.length - 1) return false
  const db = em.getKysely<OwnerLookupDatabase>()
  let query = db
    .selectFrom('custom_field_defs')
    .select('deleted_at')
    .where('entity_id', '=', recordId.slice(0, separator))
    .where('key', '=', recordId.slice(separator + 1))
    .where(sql<boolean>`tenant_id is not distinct from ${scope.tenantId}`)
  if (scope.organizationId !== undefined) {
    query = query.where(sql<boolean>`organization_id is not distinct from ${scope.organizationId}`)
  }
  const row = await query.executeTakeFirst()
  return row !== undefined && row.deleted_at !== null && row.deleted_at !== undefined
}

/**
 * Whether the record a translation belongs to still exists but is soft-deleted.
 * Omitting `organizationId` matches the record by id and tenant only.
 */
export async function isTranslatedRecordSoftDeleted(
  em: EntityManager,
  entityType: string,
  recordId: string,
  scope: TranslatedRecordScope,
): Promise<boolean> {
  if (entityType === FIELD_DEFINITION_TYPE) {
    return isFieldDefinitionTranslationSoftDeleted(em, recordId, scope)
  }
  const source = resolveSoftDeleteSource(em, entityType)
  if (!source) return false
  const db = em.getKysely<OwnerLookupDatabase>()
  let query = (source.schema ? db.withSchema(source.schema) : db)
    .selectFrom(source.tableName ?? source.table)
    .select(source.deletedAtColumn)
    .where(source.idColumn, '=', recordId)
  if (source.tenantColumn) {
    query = query.where(sql<boolean>`${sql.ref(source.tenantColumn)} is not distinct from ${scope.tenantId}`)
  }
  if (source.organizationColumn && scope.organizationId !== undefined) {
    query = query.where(sql<boolean>`${sql.ref(source.organizationColumn)} is not distinct from ${scope.organizationId}`)
  }
  const row = await query.executeTakeFirst()
  return row !== undefined && row[source.deletedAtColumn] !== null && row[source.deletedAtColumn] !== undefined
}
