import { defineUpgradeAction } from '@open-mercato/shared/modules/upgrade-actions'

export default defineUpgradeAction({
  id: 'customers.seed-deal-loss-reasons',
  version: '0.10.0',
  messageKey: 'customers.config.upgradeActions.dealLossReasons.message',
  ctaKey: 'customers.config.upgradeActions.dealLossReasons.cta',
  successKey: 'customers.config.upgradeActions.dealLossReasons.success',
  loadingKey: 'customers.config.upgradeActions.dealLossReasons.loading',
  async run({ em, tenantId, organizationId }) {
    const { seedDealLossReasons } = await import('../lib/dealLossReasons')
    await seedDealLossReasons(em, { tenantId, organizationId })
  },
})
