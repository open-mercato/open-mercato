import { createHash } from 'node:crypto'
import { defineUpgradeAction } from '@open-mercato/shared/modules/upgrade-actions'

export const ROLLBACK_FIXTURE_ACTION_ID = 'configs.test-schedule-rollback-fixture'
export const ROLLBACK_FIXTURE_QUEUE = 'configs-upgrade-rollback-fixture'

type SchedulerServiceLike = {
  register: (
    registration: Record<string, unknown>,
    options: { em: unknown; afterCommit?: (callback: () => Promise<void>) => void },
  ) => Promise<void>
}

export function rollbackFixtureScheduleId(organizationId: string): string {
  const hex = createHash('sha256').update(`${ROLLBACK_FIXTURE_ACTION_ID}:${organizationId}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/**
 * Integration-test-only action, registered only when `OM_UPGRADE_ACTION_ROLLBACK_FIXTURE=1`.
 * It registers a real schedule through the transaction-aware scheduler path and then
 * fails, so a test can prove the schedule row and the ledger row roll back together and
 * the queue is never activated.
 */
export default defineUpgradeAction({
  id: ROLLBACK_FIXTURE_ACTION_ID,
  version: '0.0.1',
  messageKey: 'configs.upgrades.testFixture.message',
  ctaKey: 'configs.upgrades.testFixture.cta',
  successKey: 'configs.upgrades.testFixture.success',
  async run({ container, em, tenantId, organizationId, deferAfterCommit }) {
    const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
    await schedulerService.register(
      {
        id: rollbackFixtureScheduleId(organizationId),
        name: 'Upgrade action rollback fixture',
        scopeType: 'organization',
        tenantId,
        organizationId,
        scheduleType: 'interval',
        scheduleValue: '1h',
        targetType: 'queue',
        targetQueue: ROLLBACK_FIXTURE_QUEUE,
        sourceType: 'module',
        sourceModule: 'configs',
        isEnabled: true,
      },
      { em, afterCommit: deferAfterCommit },
    )
    throw new Error('[internal] Rollback fixture failed on purpose after registering its schedule')
  },
})
