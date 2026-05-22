import { expect, test } from '@playwright/test'
import {
  cleanupSubscriptionSubject,
  createActivatedSubscription,
  getSubscriptionDetail,
  postStripeWebhook,
  stripeInvoiceEvent,
  waitForAccess,
} from './helpers/fixtures'

test.describe('TC-SUB-005: invoice.payment_failed webhook', () => {
  test('moves access to grace and records a failed billing event', async ({ request }) => {
    const fixture = await createActivatedSubscription(request, 'tc_sub_005')

    try {
      const invoiceId = `in_tc_sub_005_${Date.now()}`
      const webhook = await postStripeWebhook(
        request,
        stripeInvoiceEvent('invoice.payment_failed', fixture, { invoiceId, amountMinor: 1900 }),
      )
      expect(webhook.status(), await webhook.text()).toBe(202)

      const access = await waitForAccess(request, fixture.token, fixture.externalAccountId, 'grace')
      expect(access.subscriptionId).toBe(fixture.subscriptionId)

      const detail = await getSubscriptionDetail(request, fixture.token, fixture.subscriptionId)
      expect(detail.billingRecords.some((record) => record.providerInvoiceId === invoiceId && record.status === 'failed')).toBe(true)
    } finally {
      await cleanupSubscriptionSubject(request, fixture.token, fixture.companyId)
    }
  })
})
