import type { EntityManager } from '@mikro-orm/postgresql'
import { tryGetModules } from '@open-mercato/shared/lib/modules/registry'
import { synthesizeRestrictedEntityFeatures } from '@open-mercato/core/modules/entities/lib/restrictedEntityFeatures'

/**
 * The staff ACL catalog the role editor offers (`GET /api/auth/features`): every feature declared
 * by an enabled module plus the per-entity record features of the tenant's restricted custom
 * entities.
 */
export async function loadAclFeatureCatalog(em: EntityManager, tenantId: string): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const registered of tryGetModules() ?? []) {
    for (const feature of Array.isArray(registered.features) ? registered.features : []) {
      if (feature && typeof feature.id === 'string' && feature.id.length > 0) ids.add(feature.id)
    }
  }
  for (const item of await synthesizeRestrictedEntityFeatures(em, tenantId)) ids.add(item.id)
  return ids
}

/**
 * A grant the catalog knows: `*`, a catalog feature, or a wildcard (`<prefix>.*`) that covers at
 * least one catalog feature.
 */
export function isKnownAclFeature(feature: string, catalog: ReadonlySet<string>): boolean {
  if (feature === '*' || catalog.has(feature)) return true
  if (!feature.endsWith('.*')) return false
  const prefix = feature.slice(0, -1)
  if (prefix.length <= 1) return false
  for (const id of catalog) {
    if (id.startsWith(prefix)) return true
  }
  return false
}

/**
 * Proposed grants the catalog does not know. A grant the role already holds is accepted as it is
 * (the editor keeps grants it does not list, e.g. of a module that was disabled since), so only
 * grants the proposal adds are checked.
 */
export function findUnknownAclFeatures(
  proposed: readonly string[],
  catalog: ReadonlySet<string>,
  existing: readonly string[],
): string[] {
  const held = new Set(existing)
  return proposed.filter((feature) => !held.has(feature) && !isKnownAclFeature(feature, catalog))
}
