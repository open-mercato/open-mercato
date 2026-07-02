import { expect, test } from '@playwright/test'
import {
  cleanupSubscriptionSubject,
  createActivatedSubscription,
  getAccess,
} from './helpers/fixtures'

test.describe('TC-SUB-004: subscription access snapshot', () => {
  test('returns granted after activation and remains stable on repeated cached reads', async ({ request }) => {
    const fixture = await createActivatedSubscription(request, 'tc_sub_004')

    try {
      const first = await getAccess(request, fixture.token, fixture.externalAccountId)
      const second = await getAccess(request, fixture.token, fixture.externalAccountId)

      expect(first.accessState).toBe('granted')
      expect(second.accessState).toBe('granted')
      expect(second.subscriptionId).toBe(first.subscriptionId)
      expect(second.entitlements?.projectsLimit).toBe(5)
      expect(second.entitlements?.aiEnabled).toBe(false)
    } finally {
      await cleanupSubscriptionSubject(request, fixture.token, fixture.companyId)
    }
  })
})
