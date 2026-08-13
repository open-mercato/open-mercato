import type { EntityMetadata } from '@mikro-orm/core'

type MetadataRegistryLike = {
  getAll?: () => unknown
  metadata?: unknown
}

type MetadataHolder = {
  getMetadata?: () => unknown
}

/**
 * MikroORM v7 returns a `Map` from `MetadataStorage.getAll()`; v6 returned a plain
 * dictionary. `Object.values(someMap)` evaluates to `[]`, so a v6-era read of the
 * registry silently reports zero entities instead of failing loudly.
 */
function toMetadataList(value: unknown): EntityMetadata[] {
  if (!value) return []
  if (value instanceof Map) return Array.from(value.values()) as EntityMetadata[]
  if (Array.isArray(value)) return value as EntityMetadata[]
  if (typeof value === 'object') return Object.values(value as Record<string, EntityMetadata>)
  return []
}

export function listEntityMetadataFromRegistry(registry: unknown): EntityMetadata[] {
  const source = registry as MetadataRegistryLike | null | undefined
  if (!source) return []
  if (typeof source.getAll === 'function') {
    const entries = toMetadataList(source.getAll())
    if (entries.length) return entries
  }
  return toMetadataList(source.metadata)
}

/**
 * List every discovered entity metadata from an `EntityManager` or `MikroORM` instance.
 * Returns an empty array when the source exposes no metadata registry.
 */
export function listEntityMetadata(source: unknown): EntityMetadata[] {
  const holder = source as MetadataHolder | null | undefined
  if (!holder || typeof holder.getMetadata !== 'function') return []
  return listEntityMetadataFromRegistry(holder.getMetadata())
}
