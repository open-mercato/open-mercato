import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createPaymentSession, getTransactionDetails } from '@open-mercato/core/modules/payment_gateways/__integration__/helpers/fixtures'

test.describe('TC-PLP-001: pay-link page payload', () => {
  test('should expose JSON metadata and custom-field metadata through the page API', async ({ request }) => {
    const token = await getAuthToken(request)
    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 88.4,
      currencyCode: 'USD',
      paymentLink: {
        enabled: true,
        title: 'Invoice link',
        metadata: {
          brandName: 'Acme Commerce',
          logoUrl: 'https://merchant.example.com/logo.svg',
        },
        customFieldsetCode: 'invoice',
        customFields: {
          supportEmail: 'billing@example.com',
          companyName: 'Acme Commerce Ltd',
        },
      },
    })

    expect(session.paymentLinkUrl).toBeTruthy()
    const publicToken = session.paymentLinkUrl!.split('/').pop()!
    const response = await request.get(`/api/payment_link_pages/pay/${publicToken}`)
    if (!response.ok()) {
      const errorBody = await response.text()
      throw new Error(`Expected 200 but got ${response.status()}: ${errorBody}`)
    }

    const payload = await response.json()
    expect(payload.link.metadata).toMatchObject({
      brandName: 'Acme Commerce',
      logoUrl: 'https://merchant.example.com/logo.svg',
    })
    expect(payload.link.customFieldsetCode).toBe('invoice')
    expect(payload.link.customFields).toMatchObject({
      supportEmail: 'billing@example.com',
      companyName: 'Acme Commerce Ltd',
    })
    expect(Array.isArray(payload._meta?.enrichedBy)).toBe(true)
  })

  test('should expose created payment-link details on the transaction detail API via interceptor', async ({ request }) => {
    const token = await getAuthToken(request)
    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 32.1,
      currencyCode: 'USD',
      paymentLink: {
        enabled: true,
        title: 'QA payment link',
        password: '2486',
      },
    })

    const detail = await getTransactionDetails(request, token, session.transactionId)
    expect(detail.paymentLink?.id).toBeTruthy()
    expect(detail.paymentLink?.url).toContain('/pay/')
    expect(detail.paymentLink?.passwordProtected).toBe(true)
  })
})
