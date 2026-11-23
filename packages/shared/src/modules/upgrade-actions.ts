import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '../lib/di/container'

/**
 * Where an upgrade action's data effects land. `organization` actions only touch
 * rows of the selected organization; `tenant` actions write tenant-wide state
 * (e.g. tenant-scoped schedules) regardless of the selected organization.
 */
export type UpgradeActionScope = 'organization' | 'tenant'

export type UpgradeActionContext = {
  tenantId: string
  organizationId: string
  container: AppContainer
  /** Transactional manager shared with the completion ledger write. */
  em: EntityManager
  /** Runs after the ledger transaction commits (cache invalidation, queue sync). */
  deferAfterCommit?: (callback: () => void | Promise<void>) => void
}

export type UpgradeActionDefinition = {
  /** Globally unique; module-owned actions MUST be prefixed with `<moduleId>.`. */
  id: string
  /** App release version this action ships with (semver). */
  version: string
  messageKey: string
  ctaKey: string
  successKey: string
  loadingKey?: string
  /** Peer modules that must also be enabled. The owning module is always required. */
  requiredModules?: string[]
  /** Defaults to `organization`. */
  scope?: UpgradeActionScope
  /** The forward ("up") handler. */
  run: (ctx: UpgradeActionContext) => Promise<void>
  /**
   * Optional compensation. Declare it only when the inverse can distinguish this
   * action's effects from pre-existing data and later edits; it runs in the same
   * transaction that deletes the completion row. Only `organization` actions may
   * be reverted.
   */
  down?: (ctx: UpgradeActionContext) => Promise<void>
}

/** Shape of a module's `upgrades.ts` manifest. */
export type ModuleUpgradeActions = UpgradeActionDefinition[]

export function defineUpgradeAction(definition: UpgradeActionDefinition): UpgradeActionDefinition {
  return definition
}
