import { defineUpgradeAction } from '@open-mercato/shared/modules/upgrade-actions'

export default defineUpgradeAction({
  id: 'promotions.register-code-reservation-sweep-schedule',
  version: '0.9.1',
  messageKey: 'configs.upgrades.promotionsCodeReservationSweepSchedule.message',
  ctaKey: 'configs.upgrades.promotionsCodeReservationSweepSchedule.cta',
  successKey: 'configs.upgrades.promotionsCodeReservationSweepSchedule.success',
  loadingKey: 'configs.upgrades.promotionsCodeReservationSweepSchedule.loading',
  scope: 'tenant',
  async run({ container, em, tenantId, organizationId, deferAfterCommit }) {
    const { registerCodeReservationSweepSchedule } = await import('../lib/scheduling')
    await registerCodeReservationSweepSchedule(container, { tenantId, organizationId }, { em, afterCommit: deferAfterCommit })
  },
})
