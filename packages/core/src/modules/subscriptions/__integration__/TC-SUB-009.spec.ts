import { expect, test } from '@playwright/test'
import {
  cleanupSubscriptionSubject,
  createActivatedSubscription,
  getAccess,
  postStripeWebhook,
  stripeInvoiceEvent,
  stripeSubscriptionEvent,
  waitForAccess,
} from './helpers/fixtures'

test.describe('TC-SUB-009: stale subscription.updated ordering guard', () => {
  test('drops stale subscription updates without regressing access state', async ({ request }) => {
    const fixture = await createActivatedSubscription(request, 'tc_sub_009')

    try {
      const base = Math.floor(Date.now() / 1000)
      expect((await postStripeWebhook(
        request,
        stripeSubscriptionEvent('customer.subscription.updated', fixture, {
          eventId: `evt_tc_sub_009_newer_${Date.now()}`,
          created: base + 60,
        }),
      )).status()).toBe(202)

      expect((await postStripeWebhook(
        request,
        stripeInvoiceEvent('invoice.payment_failed', fixture, {
          eventId: `evt_tc_sub_009_failed_${Date.now()}`,
          created: base + 120,
          invoiceId: `in_tc_sub_009_${Date.now()}`,
        }),
      )).status()).toBe(202)
      await waitForAccess(request, fixture.token, fixture.externalAccountId, 'grace')

      expect((await postStripeWebhook(
        request,
        stripeSubscriptionEvent('customer.subscription.updated', fixture, {
          eventId: `evt_tc_sub_009_stale_${Date.now()}`,
          created: base + 30,
        }),
      )).status()).toBe(202)

      await new Promise((resolve) => setTimeout(resolve, 500))
      const access = await getAccess(request, fixture.token, fixture.externalAccountId)
      expect(access.accessState).toBe('grace')
    } finally {
      await cleanupSubscriptionSubject(request, fixture.token, fixture.companyId)
    }
  })
})
