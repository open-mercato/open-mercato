import type { EntityManager } from '@mikro-orm/postgresql'
import * as semver from 'semver'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

export type UpgradeActionContext = {
  tenantId: string
  organizationId: string
  container: AppContainer
  em: EntityManager
}

export type UpgradeActionDefinition = {
  id: string
  version: string
  messageKey: string
  ctaKey: string
  successKey: string
  loadingKey?: string
  run: (ctx: UpgradeActionContext) => Promise<void>
}

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

export const upgradeActions: UpgradeActionDefinition[] = [
  {
    id: 'customers.seed-interaction-statuses',
    version: '0.6.5',
    messageKey: 'customers.config.upgradeActions.interactionStatuses.message',
    ctaKey: 'customers.config.upgradeActions.interactionStatuses.cta',
    successKey: 'customers.config.upgradeActions.interactionStatuses.success',
    loadingKey: 'customers.config.upgradeActions.interactionStatuses.loading',
    // Existing tenants predate the `interaction_status` dictionary, so their status
    // dropdown is empty until seeded. New tenants get it via customers `seedDefaults`.
    // Lazy-imported so configs stays decoupled from customers (the catalog of actions
    // lives here, but customers code only loads when the action actually runs).
    run: async ({ em, tenantId, organizationId }) => {
      const [{ INTERACTION_STATUS_DEFAULTS }, { ensureDictionaryEntry }] = await Promise.all([
        import('@open-mercato/core/modules/customers/cli'),
        import('@open-mercato/core/modules/customers/commands/shared'),
      ])
      for (const entry of INTERACTION_STATUS_DEFAULTS) {
        await ensureDictionaryEntry(em, {
          tenantId,
          organizationId,
          kind: 'interaction_status',
          value: entry.value,
          label: entry.label,
          color: entry.color,
          icon: entry.icon,
        })
      }
    },
  },
]

export function actionsUpToVersion(version: string): UpgradeActionDefinition[] {
  return upgradeActions // NOSONAR — upgradeActions is populated at boot time by modules
    .filter((action) => compareVersions(action.version, version) <= 0)
    .sort((a, b) => compareVersions(a.version, b.version) || a.id.localeCompare(b.id))
}

export function findUpgradeAction(actionId: string, maxVersion: string): UpgradeActionDefinition | undefined {
  const matches = actionsUpToVersion(maxVersion).filter((action) => action.id === actionId)
  if (!matches.length) return undefined
  return matches[matches.length - 1]
}
