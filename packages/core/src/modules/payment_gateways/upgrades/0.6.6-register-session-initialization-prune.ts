import { defineUpgradeAction } from '@open-mercato/shared/modules/upgrade-actions'

export default defineUpgradeAction({
  id: 'payment_gateways.register-session-initialization-prune',
  version: '0.6.6',
  messageKey: 'payment_gateways.upgradeActions.sessionInitializationPrune.message',
  ctaKey: 'payment_gateways.upgradeActions.sessionInitializationPrune.cta',
  successKey: 'payment_gateways.upgradeActions.sessionInitializationPrune.success',
  loadingKey: 'payment_gateways.upgradeActions.sessionInitializationPrune.loading',
  async run({ container, em, tenantId, organizationId, deferAfterCommit }) {
    const { registerSessionInitializationPruneSchedule } = await import('../setup')
    await registerSessionInitializationPruneSchedule(
      container,
      { tenantId, organizationId },
      { em, afterCommit: deferAfterCommit },
    )
  },
})
