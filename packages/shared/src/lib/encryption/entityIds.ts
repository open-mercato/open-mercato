import type { EntityMetadata } from '@mikro-orm/core'

// Registration pattern for publishable packages
export type EntityIds = Record<string, Record<string, string>>

let _entityIds: EntityIds | null = null
let _entityIdLookup: Map<string, string> | null = null

export function registerEntityIds(E: EntityIds) {
  if (_entityIds !== null && process.env.NODE_ENV === 'development') {
    console.debug('[Bootstrap] Entity IDs re-registered (this may occur during HMR)')
  }
  _entityIds = E
  _entityIdLookup = null // Reset cache on re-registration
}

/**
 * Get registered entity IDs.
 *
 * @param throwIfNotRegistered - If true, throws error when entity IDs are not registered.
 *                               If false, returns empty object (useful during module load).
 *                               Default: true
 */
export function getEntityIds(throwIfNotRegistered = true): EntityIds {
  if (!_entityIds) {
    if (throwIfNotRegistered) {
      throw new Error('[Bootstrap] Entity IDs not registered. Call registerEntityIds() at bootstrap.')
    }
    return {} as EntityIds
  }
  return _entityIds
}

const toSnake = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .replace(/__+/g, '_')
    .toLowerCase()

function getEntityIdLookup(): Map<string, string> {
  if (_entityIdLookup) return _entityIdLookup
  const E = getEntityIds()
  const map = new Map<string, string>()
  for (const mod of Object.values(E || {})) {
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
  _entityIdLookup = map
  return map
}

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
    const lookup = getEntityIdLookup()
    for (const candidate of variants) {
      if (!candidate) continue
      const id = lookup.get(candidate)
      if (id) return id
    }
  }
  return null
}
