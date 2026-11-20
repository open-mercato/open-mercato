import type { EntityMetadata } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveQueryIndexSourceTableMetadata } from '@open-mercato/core/modules/query_index/lib/subscriber-scope'
import { listEntityMetadata } from '@open-mercato/shared/lib/db/entityMetadata'
import {
  getTranslatableFieldExpander,
  getTranslatableFields,
  isSafeTranslationField,
} from '@open-mercato/shared/lib/localization/translatable-fields'

const textColumn = /^(?:text|citext|varchar|char|character(?: varying)?)(?:\(\d+\))?$/i

export function resolveTranslationOwnerMetadata(em: EntityManager, entityType: string) {
  const source = resolveQueryIndexSourceTableMetadata(em, entityType)
  if (!source) return null
  const metadata = listEntityMetadata(em).find((entry) =>
    entry.tableName === (source.tableName ?? source.table)
    && (entry.schema && entry.schema !== '*' ? entry.schema : undefined) === source.schema,
  )
  return metadata ? { metadata, source } : null
}

export function getRegisteredTextFields(
  entityType: string,
  metadata?: EntityMetadata,
  record?: Record<string, unknown>,
): Set<string> {
  const registered = getTranslatableFields(entityType) ?? []
  const expanded = record ? getTranslatableFieldExpander(entityType)?.(record) ?? [] : []
  const fields = new Set([...registered, ...expanded.map(({ key }) => key)].filter(isSafeTranslationField))
  for (const property of metadata?.props ?? []) {
    const isText = property.columnTypes?.length
      ? property.columnTypes.every((column) => textColumn.test(column))
      : property.type === 'string' || textColumn.test(property.type)
    if (!property.primary && isText) continue
    fields.delete(property.name)
    for (const fieldName of property.fieldNames ?? []) fields.delete(fieldName)
  }
  return fields
}
