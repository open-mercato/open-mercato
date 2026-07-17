import { expect, test } from '@playwright/test'
import {
  postStripeWebhook,
  stripeSubscriptionEvent,
} from './helpers/fixtures'

test.describe('TC-SUB-013: unknown subscription webhook mapping', () => {
  test('rejects a validly signed Stripe subscription webhook when no mapping exists', async ({ request }) => {
    const response = await postStripeWebhook(
      request,
      stripeSubscriptionEvent('customer.subscription.created', {
        providerSubscriptionId: `sub_test_unknown_${Date.now()}`,
        providerCustomerId: `cus_test_unknown_${Date.now()}`,
        externalAccountId: `unknown_${Date.now()}`,
      }),
    )

    expect(response.status()).toBe(401)
  })
})
