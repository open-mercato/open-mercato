import { expect, test } from '@playwright/test'
import {
  cleanupSubscriptionSubject,
  createActivatedSubscription,
  getSubscriptionDetail,
  postStripeWebhook,
  stripeInvoiceEvent,
} from './helpers/fixtures'

test.describe('TC-SUB-008: duplicate webhook dedupe', () => {
  test('dedupes duplicate Stripe event ids and writes one billing record', async ({ request }) => {
    const fixture = await createActivatedSubscription(request, 'tc_sub_008')

    try {
      const eventId = `evt_tc_sub_008_${Date.now()}`
      const invoiceId = `in_tc_sub_008_${Date.now()}`
      const payload = stripeInvoiceEvent('invoice.paid', fixture, { eventId, invoiceId })

      expect((await postStripeWebhook(request, payload)).status()).toBe(202)
      expect((await postStripeWebhook(request, payload)).status()).toBe(202)

      await expect
        .poll(async () => {
          const detail = await getSubscriptionDetail(request, fixture.token, fixture.subscriptionId)
          return detail.billingRecords.filter((record) => record.providerInvoiceId === invoiceId && record.status === 'paid').length
        }, { timeout: 10000 })
        .toBe(1)
    } finally {
      await cleanupSubscriptionSubject(request, fixture.token, fixture.companyId)
    }
  })
})
