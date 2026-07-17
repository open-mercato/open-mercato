import { expect, test } from '@playwright/test'
import {
  cancelSubscription,
  cleanupSubscriptionSubject,
  createActivatedSubscription,
  getAccess,
  getSubscriptionDetail,
} from './helpers/fixtures'

test.describe('TC-SUB-007: cancel at period end', () => {
  test('marks cancelAtPeriodEnd without immediately removing access', async ({ request }) => {
    const fixture = await createActivatedSubscription(request, 'tc_sub_007')

    try {
      const cancelled = await cancelSubscription(request, fixture.token, fixture.subscriptionId, true)
      expect(cancelled.cancelAtPeriodEnd).toBe(true)
      expect(cancelled.accessState).toBe('granted')

      const access = await getAccess(request, fixture.token, fixture.externalAccountId)
      expect(access.accessState).toBe('granted')
      expect(access.cancelAtPeriodEnd).toBe(true)

      const detail = await getSubscriptionDetail(request, fixture.token, fixture.subscriptionId)
      expect(detail.subscription.cancelAtPeriodEnd).toBe(true)
    } finally {
      await cleanupSubscriptionSubject(request, fixture.token, fixture.companyId)
    }
  })
})
