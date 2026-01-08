import type { EntityMetadata } from '@mikro-orm/core'
import { E as GeneratedEntities } from '@open-mercato/generated/entity-ids'

const toSnake = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .replace(/__+/g, '_')
    .toLowerCase()

const ENTITY_ID_LOOKUP = (() => {
  const map = new Map<string, string>()
  for (const mod of Object.values(GeneratedEntities || {})) {
    for (const [key, entityId] of Object.entries(mod || {})) {
      const snake = toSnake(key)
      map.set(snake, entityId)
      // Also allow the original key and PascalCase class names to resolve
      map.set(key.toLowerCase(), entityId)
      map.set(
        key
          .split('_')
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(''),
        entityId,
      )
    }
  }
  return map
})()

const normalizeKey = (value: string): string =>
  value
    .replace(/["'`]/g, '')
    .replace(/[\W]+/g, '_')
    .replace(/__+/g, '_')
    .toLowerCase()

const maybeSingularize = (value: string): string => {
  if (value.endsWith('ies')) return `${value.slice(0, -3)}y`
  if (value.endsWith('s')) return value.slice(0, -1)
  return value
}

export function resolveEntityIdFromMetadata(meta: EntityMetadata<any> | undefined): string | null {
  if (!meta) return null
  const candidates = [
    (meta as any).className,
    meta.name,
    (meta as any).collection,
    (meta as any).tableName,
  ].filter(Boolean) as string[]

  for (const raw of candidates) {
    const normalized = normalizeKey(raw)
    const singular = maybeSingularize(normalized)
    const snake = toSnake(raw)
    const snakeSingular = maybeSingularize(snake)
    const variants = [
      normalized,
      singular,
      normalized.replace(/_/g, ''), // Pascal-ish fallback
      singular.replace(/_/g, ''),
      snake,
      snakeSingular,
    ]
    for (const candidate of variants) {
      if (!candidate) continue
      const id = ENTITY_ID_LOOKUP.get(candidate)
      if (id) return id
    }
  }
  return null
}
