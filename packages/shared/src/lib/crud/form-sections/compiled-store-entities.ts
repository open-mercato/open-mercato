import { MetadataStorage, ReferenceKind, type EntityClass, type EntityMetadata } from '@mikro-orm/core'
import { getOrmEntities } from '../../db/mikro'
import { getEntityIds } from '../../encryption/entityIds'

const scopedProperties = ['tenantId', 'organizationId', 'hostId'] as const
const identityProperties = ['id', ...scopedProperties, 'updatedAt'] as const

export type CompiledStoreRow = Record<string, unknown> & {
  id: string
  tenantId: string
  organizationId: string
  hostId: string
  updatedAt: Date
}

function snake(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/\W+/g, '_')
    .replace(/_{2,}/g, '_').replace(/(?:^_+|_+$)/g, '').toLowerCase()
}

export type CompiledStoreEntityExports = Record<string, unknown>

function isEntityClass(value: unknown): value is EntityClass<CompiledStoreRow> {
  return typeof value === 'function' && 'prototype' in value && typeof value.prototype === 'object'
}

function exactlyScoped(properties: string | readonly string[] | undefined): boolean {
  if (!Array.isArray(properties)) return false
  const values = new Set(properties)
  return values.size === scopedProperties.length && properties.length === values.size
    && scopedProperties.every((property) => values.has(property))
}

function hasStorageContract(metadata: EntityMetadata | undefined, fields: readonly string[], mirror: boolean): boolean {
  if (!metadata || metadata.abstract || !metadata.properties.id?.primary
      || Object.values(metadata.properties).filter(({ primary }) => primary).length !== 1) return false
  if (!metadata.uniques.some(({ properties }) => exactlyScoped(properties))) return false
  const required = [...identityProperties, ...(mirror ? ['values'] : fields)]
  if (new Set(required).size !== required.length) return false
  if (required.some((name) => metadata.properties[name]?.kind !== ReferenceKind.SCALAR)) return false
  if (identityProperties.some((property) => metadata.properties[property]?.nullable)) return false
  if (mirror && (!metadata.properties.values.nullable || !['json', 'jsonb', 'object', 'JsonType'].some((kind) =>
    metadata.properties.values.type === kind || metadata.properties.values.runtimeType === kind
    || metadata.properties.values.columnTypes?.includes(kind)))) return false
  return Object.is(metadata.properties.updatedAt.type, Date) || metadata.properties.updatedAt.type === 'Date'
    || metadata.properties.updatedAt.type === 'datetime' || metadata.properties.updatedAt.runtimeType === 'Date'
}

export function resolveCompiledStoreEntity(
  ownerModuleId: string, entityId: string, fields: readonly string[], exports: CompiledStoreEntityExports | undefined, mirror = false,
): EntityClass<CompiledStoreRow> | null {
  const prefix = ownerModuleId + ':'
  if (!entityId.startsWith(prefix) || !exports) return null
  const key = entityId.slice(prefix.length)
  const owner = getEntityIds(false)[ownerModuleId]
  if (!owner || !Object.hasOwn(owner, key) || owner[key] !== entityId) return null
  const registered: unknown[] = getOrmEntities()
  const matches = Object.entries(exports).filter(([name, entity]) => snake(name) === key && registered.includes(entity))
    .map(([, entity]) => entity).filter(isEntityClass)
  if (matches.length !== 1) return null
  const [entity] = matches
  const metadata = Object.values(MetadataStorage.getMetadata()).filter(({ class: entityClass }) => Object.is(entityClass, entity))
  return metadata.length === 1 && hasStorageContract(metadata[0], fields, mirror) ? entity : null
}
