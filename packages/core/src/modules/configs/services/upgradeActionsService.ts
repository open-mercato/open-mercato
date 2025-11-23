import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { appVersion } from '@open-mercato/shared/lib/version'
import { UpgradeActionRun } from '../data/entities'
import { actionsForVersion, findUpgradeAction, type UpgradeActionDefinition } from '../lib/upgrade-actions'

export type UpgradeActionStatus = 'completed' | 'already_completed'

export function getCurrentVersion(): string {
  return appVersion
}

export async function listPendingUpgradeActions(
  em: EntityManager,
  {
    tenantId,
    organizationId,
    version = appVersion,
  }: { tenantId: string; organizationId: string; version?: string },
): Promise<UpgradeActionDefinition[]> {
  const definitions = actionsForVersion(version)
  if (!definitions.length) return []
  const runs = await em.find(UpgradeActionRun, {
    tenantId,
    organizationId,
    version,
  })
  const completed = new Set(runs.map((run) => run.actionId))
  return definitions.filter((definition) => !completed.has(definition.id))
}

export async function executeUpgradeAction(
  container: AwilixContainer,
  {
    actionId,
    tenantId,
    organizationId,
    version = appVersion,
  }: { actionId: string; tenantId: string; organizationId: string; version?: string },
): Promise<{ action: UpgradeActionDefinition; status: UpgradeActionStatus }> {
  const definition = findUpgradeAction(actionId, version)
  if (!definition) {
    throw new Error('UPGRADE_ACTION_NOT_AVAILABLE')
  }
  const em = container.resolve<EntityManager>('em')
  const status = await em.transactional(async (tem) => {
    console.info('[upgrade-actions] executing', { actionId: definition.id, version, tenantId, organizationId })
    const alreadyCompleted = await tem.findOne(UpgradeActionRun, {
      actionId: definition.id,
      version,
      tenantId,
      organizationId,
    })
    if (alreadyCompleted) return 'already_completed' as const
    await definition.run({ container, em: tem, tenantId, organizationId })
    const record = tem.create(UpgradeActionRun, {
      actionId: definition.id,
      version,
      tenantId,
      organizationId,
    })
    tem.persist(record)
    await tem.flush()
    console.info('[upgrade-actions] completed', { actionId: definition.id, version, tenantId, organizationId })
    return 'completed' as const
  }).catch((error) => {
    console.error('[upgrade-actions] failed', { actionId, tenantId, organizationId, version, error })
    if (error instanceof UniqueConstraintViolationException) {
      return 'already_completed' as const
    }
    throw error
  })

  return { action: definition, status }
}
