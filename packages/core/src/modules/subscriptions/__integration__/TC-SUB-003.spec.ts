import { expect, test } from '@playwright/test'
import {
  cleanupSubscriptionSubject,
  createActivatedSubscription,
  getSubscriptionDetail,
  listSubscriptions,
} from './helpers/fixtures'

test.describe('TC-SUB-003: subscription.created webhook', () => {
  test('resolves scope via mapping and inserts a local subscription', async ({ request }) => {
    const fixture = await createActivatedSubscription(request, 'tc_sub_003')

    try {
      const list = await listSubscriptions(request, fixture.token, fixture.externalAccountId)
      expect(list.items).toHaveLength(1)
      expect(list.items[0]?.providerSubscriptionId).toBe(fixture.providerSubscriptionId)

      const detail = await getSubscriptionDetail(request, fixture.token, fixture.subscriptionId)
      expect(detail.subscription.externalAccountId).toBe(fixture.externalAccountId)
      expect(detail.subscription.providerSubscriptionId).toBe(fixture.providerSubscriptionId)
      expect(detail.subscription.accessState).toBe('granted')
    } finally {
      await cleanupSubscriptionSubject(request, fixture.token, fixture.companyId)
    }
  })
})
