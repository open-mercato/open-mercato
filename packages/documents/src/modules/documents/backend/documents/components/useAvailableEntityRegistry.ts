"use client"

import * as React from 'react'
import {
  getEnabledModuleIds,
  getInjectionRegistryVersion,
  subscribeToInjectionRegistryChanges,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import type { DocumentEntityRegistryEntry } from '../../../lib/entityRegistry'

export function filterDocumentEntityRegistryByEnabledModules(
  entries: readonly DocumentEntityRegistryEntry[],
  enabledModuleIds: ReadonlySet<string> | null,
): DocumentEntityRegistryEntry[] {
  if (!enabledModuleIds) return []
  return entries.filter((entry) => (
    enabledModuleIds.has(entry.requiredModule)
    && enabledModuleIds.has(entry.requiredFeatureModule)
  ))
}

/**
 * Client-side peer availability backed by the enabled-module registry that
 * ClientBootstrap populates. Until bootstrap has registered the canonical
 * set, peer entity types remain hidden rather than being guessed from stale
 * ACL grants or the presence of injection widgets.
 */
export function useAvailableDocumentEntityRegistry(
  entries: readonly DocumentEntityRegistryEntry[],
): { entries: DocumentEntityRegistryEntry[]; isRegistryReady: boolean } {
  const registryVersion = React.useSyncExternalStore(
    subscribeToInjectionRegistryChanges,
    getInjectionRegistryVersion,
    () => 0,
  )
  const enabledModuleIds = getEnabledModuleIds()
  const availableEntries = React.useMemo(
    () => filterDocumentEntityRegistryByEnabledModules(entries, enabledModuleIds),
    // Registry changes replace the canonical Set and bump this version.
    [enabledModuleIds, entries, registryVersion],
  )
  return { entries: availableEntries, isRegistryReady: enabledModuleIds !== null }
}
