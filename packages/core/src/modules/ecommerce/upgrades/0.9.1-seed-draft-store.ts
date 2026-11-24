import { defineUpgradeAction } from '@open-mercato/shared/modules/upgrade-actions'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('ecommerce').child({ component: 'upgrade-actions' })

type BaseCurrencyResolver = {
  resolveBaseCurrency(scope: {
    tenantId: string
    organizationIds: string[]
  }): Promise<{ status: 'resolved'; code: string } | { status: 'missing' | 'ambiguous' | 'unavailable' }>
}

export default defineUpgradeAction({
  id: 'ecommerce.seed-draft-store',
  version: '0.9.1',
  messageKey: 'configs.upgrades.ecommerceDraftStore.message',
  ctaKey: 'configs.upgrades.ecommerceDraftStore.cta',
  successKey: 'configs.upgrades.ecommerceDraftStore.success',
  loadingKey: 'configs.upgrades.ecommerceDraftStore.loading',
  async run({ container, em, tenantId, organizationId }) {
    const { seedDraftStore } = await import('../lib/seedDraftStore')
    const result = await seedDraftStore(
      em,
      { tenantId, organizationId },
      {
        resolveCurrencyCode: async () => {
          try {
            const resolver = container.resolve<BaseCurrencyResolver>('baseCurrencyService')
            const resolution = await resolver.resolveBaseCurrency({ tenantId, organizationIds: [organizationId] })
            return resolution.status === 'resolved' ? resolution.code : null
          } catch {
            return null
          }
        },
      },
    )
    logger.info('ecommerce draft store seed completed', { tenantId, organizationId, status: result.status })
  },
})
