import { getEnabledModuleIds } from '@open-mercato/shared/security/enabledModulesRegistry'
import type { DocumentEntityRegistryEntry } from './entityRegistry'

/**
 * Returns whether the peer module backing a Documents entity-registry entry
 * is enabled in the running application.
 *
 * The bootstrapped module registry is the canonical server-side source. An
 * empty/unavailable registry therefore fails closed for peer-backed entries;
 * stale ACL grants (including superadmin wildcards) must never make a disabled
 * module addressable through Documents.
 */
export function isDocumentEntityRegistryModuleEnabled(
  entry: Pick<DocumentEntityRegistryEntry, 'requiredModule' | 'requiredFeatureModule'>,
): boolean {
  const enabledModuleIds = new Set(getEnabledModuleIds())
  return enabledModuleIds.has(entry.requiredModule)
    && enabledModuleIds.has(entry.requiredFeatureModule)
}
