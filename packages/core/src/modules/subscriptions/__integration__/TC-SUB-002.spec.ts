import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  cleanupSubscriptionSubject,
  createCheckout,
  createSubscriptionSubject,
  getAccess,
  syncPlans,
  uniqueExternalAccountId,
} from './helpers/fixtures'

test.describe('TC-SUB-002: subscription checkout', () => {
  test('creates a Stripe customer mapping and returns a Checkout URL', async ({ request }) => {
    const token = await getAuthToken(request)
    let companyId: string | null = null

    try {
      await syncPlans(request, token)
      const subject = await createSubscriptionSubject(request, token, `QA TC-SUB-002 ${Date.now()}`)
      companyId = subject.entityId
      const externalAccountId = uniqueExternalAccountId('tc_sub_002')
      const checkout = await createCheckout(request, token, { externalAccountId, subjectEntityId: subject.profileId })

      expect(new URL(checkout.checkoutUrl).hostname).toBe('checkout.stripe.test')
      expect(checkout.providerSubscriptionId).toMatch(/^sub_test_om_/)
      expect(checkout.providerCustomerId).toMatch(/^cus_test_om_/)

      const access = await getAccess(request, token, externalAccountId)
      expect(access.accessState).toBe('blocked')
      expect(access.subscriptionId).toBeNull()
    } finally {
      await cleanupSubscriptionSubject(request, token, companyId)
    }
  })
})
