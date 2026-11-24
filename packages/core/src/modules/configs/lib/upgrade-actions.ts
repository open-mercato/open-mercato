import * as semver from 'semver'
import type { UpgradeActionDefinition } from '@open-mercato/shared/modules/upgrade-actions'
import { createUpgradeActionCatalog } from './upgrade-action-catalog'

export type {
  UpgradeActionContext,
  UpgradeActionDefinition,
  UpgradeActionScope,
} from '@open-mercato/shared/modules/upgrade-actions'

/**
 * Compare two semantic version strings.
 * Uses the semver library for robust version comparison.
 * Returns negative if a < b, positive if a > b, 0 if equal.
 * Throws an error if either version string is invalid.
 */
export function compareVersions(a: string, b: string): number {
  const cleanA = semver.valid(semver.coerce(a))
  const cleanB = semver.valid(semver.coerce(b))
  if (!cleanA) {
    throw new Error(`Invalid version string: "${a}". Expected a valid semver format (e.g., "1.2.3").`)
  }
  if (!cleanB) {
    throw new Error(`Invalid version string: "${b}". Expected a valid semver format (e.g., "1.2.3").`)
  }
  return semver.compare(cleanA, cleanB)
}

/**
 * Every enabled upgrade action. Module-owned actions are declared in each module's
 * `upgrades.ts` and synced in from the registered modules; this array reflects them
 * after bootstrap. Pushing a definition into this array is a deprecated legacy
 * registration path kept for one minor release; declare actions in the owning
 * module's `upgrades.ts` instead.
 */
export const upgradeActions: UpgradeActionDefinition[] = []

const catalog = createUpgradeActionCatalog(upgradeActions)

/** Owning module of a manifest-declared action; `null` for manual legacy registrations. */
export function getUpgradeActionOwner(action: UpgradeActionDefinition): string | null {
  return catalog.ownerOf(action)
}

export function actionsUpToVersion(version: string): UpgradeActionDefinition[] {
  return catalog
    .list()
    .filter((action) => compareVersions(action.version, version) <= 0)
    .sort((a, b) => compareVersions(a.version, b.version) || a.id.localeCompare(b.id))
}

export function findUpgradeAction(actionId: string, maxVersion: string): UpgradeActionDefinition | undefined {
  const matches = actionsUpToVersion(maxVersion).filter((action) => action.id === actionId)
  if (!matches.length) return undefined
  return matches[matches.length - 1]
}
