import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createPaymentSession } from '../../payment_gateways/__integration__/helpers/fixtures'

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
})
