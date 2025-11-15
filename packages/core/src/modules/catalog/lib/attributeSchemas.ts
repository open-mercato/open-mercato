import type { CatalogAttributeSchema } from '../data/types'

function clone<T>(value: T): T {
  if (value === null || value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function normalizeAttributeSchema(schema?: CatalogAttributeSchema | null): CatalogAttributeSchema | null {
  if (!schema) return null
  return clone(schema)
}

export function resolveAttributeSchema(
  base?: CatalogAttributeSchema | null,
  override?: CatalogAttributeSchema | null
): CatalogAttributeSchema | null {
  if (override && override.definitions?.length) {
    return clone({
      ...override,
      definitions: override.definitions.map((definition) => clone(definition)),
    })
  }
  if (override) return clone(override)
  if (!base) return null
  return clone({
    ...base,
    definitions: base.definitions.map((definition) => clone(definition)),
  })
}
