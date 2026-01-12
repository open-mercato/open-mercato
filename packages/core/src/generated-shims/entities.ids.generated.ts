/**
 * Shim for #generated/entities.ids.generated
 *
 * This allows packages to continue using `import { E } from '#generated/entities.ids.generated'`
 * while actually getting the entityIds from the registration pattern.
 *
 * The actual entityIds are registered at bootstrap time via registerEntityIds().
 * During module load (before bootstrap), accessing E will return undefined values.
 * This is safe because the actual values are only used at runtime, not at module load time.
 */
import { getEntityIds, type EntityIds } from '@open-mercato/shared/lib/encryption/entityIds'

// Helper function that returns a nested proxy for module access (E.auth.user)
function createModuleProxy(moduleName: string): Record<string, string> {
  return new Proxy({} as Record<string, string>, {
    get(_, entityName: string) {
      const entityIds = getEntityIds(false) // Don't throw during module load
      return entityIds[moduleName]?.[entityName]
    },
  })
}

// Export E as a proxy that delegates to the registered entityIds
// Using getEntityIds(false) to avoid throwing during module load
export const E: EntityIds = new Proxy({} as EntityIds, {
  get(_, prop: string) {
    // Return a nested proxy for module access (E.auth.user)
    return createModuleProxy(prop)
  },
  has(_, prop: string) {
    const entityIds = getEntityIds(false)
    return prop in entityIds
  },
  ownKeys() {
    const entityIds = getEntityIds(false)
    return Object.keys(entityIds)
  },
  getOwnPropertyDescriptor(_, prop: string) {
    const entityIds = getEntityIds(false)
    if (prop in entityIds) {
      return {
        enumerable: true,
        configurable: true,
        value: createModuleProxy(prop),
      }
    }
    return undefined
  },
})
