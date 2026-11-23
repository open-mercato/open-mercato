import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { appVersion } from '@open-mercato/shared/lib/version'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { withAdvisoryXactLock } from '@open-mercato/shared/lib/db/advisoryLock'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { UpgradeActionRun } from '../data/entities'
import { Organization, Tenant } from '../../directory/data/entities'
import { actionsUpToVersion, findUpgradeAction, getUpgradeActionOwner, type UpgradeActionDefinition } from '../lib/upgrade-actions'
import { isUpgradeActionAvailable, resolveUpgradeActionScope } from '../lib/upgrade-action-catalog'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('configs')

const LOCK_NAMESPACE = 'configs_upgrade_actions'
const LOCK_OPTIONS = { waitDeadlineMs: 60_000 }

export type UpgradeActionStatus = 'completed' | 'already_completed'

export type UpgradeActionErrorCode =
  | 'UPGRADE_ACTIONS_DISABLED'
  | 'UPGRADE_ACTION_NOT_AVAILABLE'
  | 'UPGRADE_ACTION_NOT_REVERSIBLE'
  | 'UPGRADE_ACTION_NOT_APPLIED'
  | 'UPGRADE_ACTION_SCOPE_INVALID'

/** The message is the code, which keeps the existing HTTP `details` values. */
export class UpgradeActionError extends Error {
  readonly code: UpgradeActionErrorCode
  constructor(code: UpgradeActionErrorCode) {
    super(code)
    this.name = 'UpgradeActionError'
    this.code = code
  }
}

/**
 * The action's data and ledger row committed, but a post-commit effect (cache
 * invalidation, queue sync) failed. Retrying never reruns the handler.
 */
export class UpgradeActionPostCommitError extends Error {
  readonly action: UpgradeActionDefinition
  readonly failures: unknown[]
  constructor(action: UpgradeActionDefinition, failures: unknown[]) {
    super(`[internal] Upgrade action ${action.id}@${action.version} committed but ${failures.length} post-commit step(s) failed`)
    this.name = 'UpgradeActionPostCommitError'
    this.action = action
    this.failures = failures
  }
}

export function isUpgradeActionsEnabled(): boolean {
  return parseBooleanToken(process.env.UPGRADE_ACTIONS_ENABLED ?? '') === true
}

export function getCurrentVersion(): string {
  return appVersion
}

export function isActionModuleEnabled(definition: UpgradeActionDefinition): boolean {
  return isUpgradeActionAvailable(definition, getUpgradeActionOwner(definition))
}

function upgradeActionLockKey(definition: UpgradeActionDefinition, scope: { tenantId: string; organizationId: string }): string {
  const scopePart = resolveUpgradeActionScope(definition) === 'tenant' ? 'tenant' : scope.organizationId
  return `${LOCK_NAMESPACE}:${scope.tenantId}:${scopePart}:${definition.version}:${definition.id}`
}

export function findExactUpgradeAction(
  actionId: string,
  actionVersion: string,
  maxVersion: string = appVersion,
): UpgradeActionDefinition | undefined {
  return actionsUpToVersion(maxVersion).find((action) => action.id === actionId && action.version === actionVersion)
}

function resolveAvailableDefinition(
  actionId: string,
  actionVersion: string | undefined,
  maxVersion: string,
): UpgradeActionDefinition {
  const definition = actionVersion
    ? findExactUpgradeAction(actionId, actionVersion, maxVersion)
    : findUpgradeAction(actionId, maxVersion)
  if (!definition || !isActionModuleEnabled(definition)) {
    throw new UpgradeActionError('UPGRADE_ACTION_NOT_AVAILABLE')
  }
  return definition
}

async function runAfterCommit(
  definition: UpgradeActionDefinition,
  callbacks: Array<() => void | Promise<void>>,
): Promise<void> {
  const failures: unknown[] = []
  for (const callback of callbacks) {
    try {
      await callback()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) {
    logger.error('Upgrade action post-commit step failed', {
      component: 'upgrade-actions',
      actionId: definition.id,
      version: definition.version,
      err: failures[0],
    })
    throw new UpgradeActionPostCommitError(definition, failures)
  }
}

export type UpgradeActionState = {
  id: string
  version: string
  ownerModuleId: string | null
  scope: 'organization' | 'tenant' | null
  applied: boolean
  available: boolean
  reversible: boolean
}

/**
 * Every catalog action up to `version` plus completion rows whose definition is no
 * longer registered (shown as applied and unavailable), in execution order.
 */
export async function listUpgradeActionStates(
  em: EntityManager,
  { tenantId, organizationId, version = appVersion }: { tenantId: string; organizationId: string; version?: string },
): Promise<UpgradeActionState[]> {
  const definitions = actionsUpToVersion(version)
  const runs = await em.find(UpgradeActionRun, { tenantId, organizationId })
  const completed = new Set(runs.map((run) => `${run.version}::${run.actionId}`))
  const states: UpgradeActionState[] = definitions.map((definition) => {
    const scope = resolveUpgradeActionScope(definition)
    return {
      id: definition.id,
      version: definition.version,
      ownerModuleId: getUpgradeActionOwner(definition),
      scope,
      applied: completed.has(`${definition.version}::${definition.id}`),
      available: isActionModuleEnabled(definition),
      reversible: typeof definition.down === 'function' && scope === 'organization',
    }
  })
  const known = new Set(definitions.map((definition) => `${definition.version}::${definition.id}`))
  for (const run of runs) {
    if (known.has(`${run.version}::${run.actionId}`)) continue
    states.push({
      id: run.actionId,
      version: run.version,
      ownerModuleId: null,
      scope: null,
      applied: true,
      available: false,
      reversible: false,
    })
  }
  return states
}

/** CLI scope gate: an active tenant and an active organization that belongs to it. */
export async function validateUpgradeActionScope(
  em: EntityManager,
  { tenantId, organizationId }: { tenantId: string; organizationId: string },
): Promise<void> {
  const tenant = await findOneWithDecryption(em, Tenant, { id: tenantId, isActive: true, deletedAt: null })
  const organization = tenant
    ? await findOneWithDecryption(
        em,
        Organization,
        { id: organizationId, tenant: tenantId, isActive: true, deletedAt: null },
        {},
        { tenantId, organizationId },
      )
    : null
  if (!tenant || !organization) throw new UpgradeActionError('UPGRADE_ACTION_SCOPE_INVALID')
}

/**
 * A unique violation only means "already completed" when the ledger row now exists
 * (a writer outside the lock, such as an older binary, won the race). A violation
 * raised by the handler's own writes is a failure and must not be reported as done.
 */
async function isUpgradeActionRecorded(
  em: EntityManager,
  definition: UpgradeActionDefinition,
  { tenantId, organizationId }: { tenantId: string; organizationId: string },
): Promise<boolean> {
  const record = await em.fork().findOne(UpgradeActionRun, {
    actionId: definition.id,
    version: definition.version,
    tenantId,
    organizationId,
  })
  return record !== null
}

export async function listPendingUpgradeActions(
  em: EntityManager,
  {
    tenantId,
    organizationId,
    version = appVersion,
  }: { tenantId: string; organizationId: string; version?: string },
): Promise<UpgradeActionDefinition[]> {
  if (!isUpgradeActionsEnabled()) return []
  const definitions = actionsUpToVersion(version)
  if (!definitions.length) return []
  const versions = Array.from(new Set(definitions.map((definition) => definition.version)))
  const runs = await em.find(UpgradeActionRun, {
    tenantId,
    organizationId,
    version: { $in: versions },
  })
  const completed = new Set(runs.map((run) => `${run.version}::${run.actionId}`))
  return definitions
    .filter((definition) => !completed.has(`${definition.version}::${definition.id}`))
    .filter(isActionModuleEnabled)
}

export async function executeUpgradeAction(
  container: AwilixContainer,
  {
    actionId,
    actionVersion,
    tenantId,
    organizationId,
    version = appVersion,
  }: { actionId: string; actionVersion?: string; tenantId: string; organizationId: string; version?: string },
): Promise<{ action: UpgradeActionDefinition; status: UpgradeActionStatus }> {
  if (!isUpgradeActionsEnabled()) {
    throw new UpgradeActionError('UPGRADE_ACTIONS_DISABLED')
  }
  const definition = resolveAvailableDefinition(actionId, actionVersion, version)
  const em = container.resolve<EntityManager>('em')
  const afterCommitCallbacks: Array<() => void | Promise<void>> = []
  let status: UpgradeActionStatus
  try {
    status = await withAdvisoryXactLock(em, upgradeActionLockKey(definition, { tenantId, organizationId }), async (tem) => {
      logger.info('Executing upgrade action', {
        component: 'upgrade-actions',
        actionId: definition.id,
        version: definition.version,
        requestedVersion: version,
        tenantId,
        organizationId,
      })
      const alreadyCompleted = await tem.findOne(UpgradeActionRun, {
        actionId: definition.id,
        version: definition.version,
        tenantId,
        organizationId,
      })
      if (alreadyCompleted) return 'already_completed' as const
      await definition.run({
        container,
        em: tem,
        tenantId,
        organizationId,
        deferAfterCommit: (callback) => afterCommitCallbacks.push(callback),
      })
      tem.persist(tem.create(UpgradeActionRun, {
        actionId: definition.id,
        version: definition.version,
        tenantId,
        organizationId,
      }))
      await tem.flush()
      logger.info('Upgrade action completed', { component: 'upgrade-actions', actionId: definition.id, version: definition.version, tenantId, organizationId })
      return 'completed' as const
    }, LOCK_OPTIONS)
  } catch (error) {
    const completedElsewhere =
      error instanceof UniqueConstraintViolationException &&
      (await isUpgradeActionRecorded(em, definition, { tenantId, organizationId }))
    if (!completedElsewhere) {
      logger.error('Upgrade action failed', { component: 'upgrade-actions', actionId, tenantId, organizationId, version, err: error })
      throw error
    }
    status = 'already_completed'
  }

  if (status === 'completed') await runAfterCommit(definition, afterCommitCallbacks)

  return { action: definition, status }
}

/**
 * Runs the action's declared compensation and deletes its exact completion row in
 * one transaction, so it becomes pending again. Fails without touching the row
 * when the action is unavailable, forward-only, unapplied, or its `down` throws.
 */
export async function revertUpgradeAction(
  container: AwilixContainer,
  {
    actionId,
    actionVersion,
    tenantId,
    organizationId,
    version = appVersion,
  }: { actionId: string; actionVersion: string; tenantId: string; organizationId: string; version?: string },
): Promise<{ action: UpgradeActionDefinition; status: 'reverted' }> {
  if (!isUpgradeActionsEnabled()) {
    throw new UpgradeActionError('UPGRADE_ACTIONS_DISABLED')
  }
  const definition = resolveAvailableDefinition(actionId, actionVersion, version)
  const down = definition.down
  if (typeof down !== 'function' || resolveUpgradeActionScope(definition) !== 'organization') {
    throw new UpgradeActionError('UPGRADE_ACTION_NOT_REVERSIBLE')
  }
  const em = container.resolve<EntityManager>('em')
  const afterCommitCallbacks: Array<() => void | Promise<void>> = []
  await withAdvisoryXactLock(em, upgradeActionLockKey(definition, { tenantId, organizationId }), async (tem) => {
    const record = await tem.findOne(UpgradeActionRun, {
      actionId: definition.id,
      version: definition.version,
      tenantId,
      organizationId,
    })
    if (!record) throw new UpgradeActionError('UPGRADE_ACTION_NOT_APPLIED')
    await down({
      container,
      em: tem,
      tenantId,
      organizationId,
      deferAfterCommit: (callback) => afterCommitCallbacks.push(callback),
    })
    tem.remove(record)
    await tem.flush()
    logger.info('Upgrade action reverted', {
      component: 'upgrade-actions',
      actionId: definition.id,
      version: definition.version,
      tenantId,
      organizationId,
    })
  }, LOCK_OPTIONS)
  await runAfterCommit(definition, afterCommitCallbacks)
  return { action: definition, status: 'reverted' }
}
