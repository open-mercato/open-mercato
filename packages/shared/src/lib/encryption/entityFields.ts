// Registration pattern for entity fields (for Turbopack compatibility)
export type EntityFieldsRegistry = Record<string, Record<string, string>>

let _entityFieldsRegistry: EntityFieldsRegistry | null = null

export function registerEntityFields(registry: EntityFieldsRegistry) {
  if (_entityFieldsRegistry !== null && process.env.NODE_ENV === 'development') {
    console.debug('[Bootstrap] Entity fields re-registered (this may occur during HMR)')
  }
  _entityFieldsRegistry = registry
}

/**
 * Get registered entity fields.
 *
 * @param throwIfNotRegistered - If true, throws error when entity fields are not registered.
 *                               If false, returns empty object (useful during module load).
 *                               Default: true
 */
export function getEntityFieldsRegistry(throwIfNotRegistered = true): EntityFieldsRegistry {
  if (!_entityFieldsRegistry) {
    if (throwIfNotRegistered) {
      throw new Error('[Bootstrap] Entity fields not registered. Call registerEntityFields() at bootstrap.')
    }
    return {} as EntityFieldsRegistry
  }
  return _entityFieldsRegistry
}

/**
 * Get fields for a specific entity by slug.
 *
 * @param slug - The entity slug (e.g., 'user', 'sales_order')
 * @returns The entity's fields or undefined if not found
 */
export function getEntityFields(slug: string): Record<string, string> | undefined {
  const registry = getEntityFieldsRegistry(false)
  return registry[slug]
}
