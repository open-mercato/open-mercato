import { expect, test } from '@playwright/test'
import {
  cleanupSubscriptionSubject,
  createActivatedSubscription,
  postStripeWebhook,
  refreshSubscription,
  stripeInvoiceEvent,
  waitForAccess,
} from './helpers/fixtures'

test.describe('TC-SUB-011: subscription reconciliation refresh', () => {
  test('applies provider truth and restores granted access after local drift', async ({ request }) => {
    const fixture = await createActivatedSubscription(request, 'tc_sub_011')

    try {
      expect((await postStripeWebhook(
        request,
        stripeInvoiceEvent('invoice.payment_failed', fixture, { invoiceId: `in_tc_sub_011_${Date.now()}` }),
      )).status()).toBe(202)
      await waitForAccess(request, fixture.token, fixture.externalAccountId, 'grace')

      const refreshed = await refreshSubscription(request, fixture.token, fixture.subscriptionId)
      expect(refreshed.providerStatus).toBe('active')
      await waitForAccess(request, fixture.token, fixture.externalAccountId, 'granted')
    } finally {
      await cleanupSubscriptionSubject(request, fixture.token, fixture.companyId)
    }
  })
})
