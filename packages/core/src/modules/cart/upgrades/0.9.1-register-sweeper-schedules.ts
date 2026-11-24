import { defineUpgradeAction } from '@open-mercato/shared/modules/upgrade-actions'

export default defineUpgradeAction({
  id: 'cart.register-sweeper-schedules',
  version: '0.9.1',
  messageKey: 'configs.upgrades.cartSweeperSchedules.message',
  ctaKey: 'configs.upgrades.cartSweeperSchedules.cta',
  successKey: 'configs.upgrades.cartSweeperSchedules.success',
  loadingKey: 'configs.upgrades.cartSweeperSchedules.loading',
  scope: 'tenant',
  async run({ container, em, tenantId, organizationId, deferAfterCommit }) {
    const { registerCartSweeperSchedules } = await import('../lib/scheduling')
    await registerCartSweeperSchedules(container, { tenantId, organizationId }, { em, afterCommit: deferAfterCommit })
  },
})
