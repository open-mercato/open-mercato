import { expect, test } from '@playwright/test'
import {
  cleanupSubscriptionSubject,
  createActivatedSubscription,
  getSubscriptionDetail,
  postStripeWebhook,
  stripeInvoiceEvent,
  waitForAccess,
} from './helpers/fixtures'

test.describe('TC-SUB-006: invoice.paid webhook after grace', () => {
  test('restores access to granted and appends a paid billing record', async ({ request }) => {
    const fixture = await createActivatedSubscription(request, 'tc_sub_006')

    try {
      const failedInvoiceId = `in_tc_sub_006_failed_${Date.now()}`
      const paidInvoiceId = `in_tc_sub_006_paid_${Date.now()}`

      expect((await postStripeWebhook(request, stripeInvoiceEvent('invoice.payment_failed', fixture, { invoiceId: failedInvoiceId }))).status()).toBe(202)
      await waitForAccess(request, fixture.token, fixture.externalAccountId, 'grace')

      expect((await postStripeWebhook(request, stripeInvoiceEvent('invoice.paid', fixture, { invoiceId: paidInvoiceId }))).status()).toBe(202)
      await waitForAccess(request, fixture.token, fixture.externalAccountId, 'granted')

      const detail = await getSubscriptionDetail(request, fixture.token, fixture.subscriptionId)
      expect(detail.billingRecords.some((record) => record.providerInvoiceId === failedInvoiceId && record.status === 'failed')).toBe(true)
      expect(detail.billingRecords.some((record) => record.providerInvoiceId === paidInvoiceId && record.status === 'paid')).toBe(true)
    } finally {
      await cleanupSubscriptionSubject(request, fixture.token, fixture.companyId)
    }
  })
})
