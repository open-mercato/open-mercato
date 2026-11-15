import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCustomerData,
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  readCheckoutTransaction,
  submitPayLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-036: Submit payment rejects invalid customer email and phone formats', () => {
  test('returns field errors for malformed email and phone values', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, createFixedTemplateInput({ status: 'active' }))
      linkId = link.id

      const response = await submitPayLink(request, link.slug, {
        customerData: createCustomerData({
          email: 'emailwithoutdomain',
          phone: 'wrong phone number',
        }),
        acceptedLegalConsents: {},
        amount: 49.99,
      })

      expect(response.status()).toBe(422)

      const body = await response.json()
      expect(body.fieldErrors).toMatchObject({
        'customerData.email': 'checkout.payPage.validation.invalidEmail',
        'customerData.phone': 'checkout.payPage.validation.invalidPhone',
      })
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })

  test('returns field errors for oversized declared names', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, createFixedTemplateInput({ status: 'active' }))
      linkId = link.id

      const response = await submitPayLink(request, link.slug, {
        customerData: createCustomerData({ firstName: 'A'.repeat(101), lastName: 'B'.repeat(101) }),
        acceptedLegalConsents: {},
        amount: 49.99,
      })

      expect(response.status()).toBe(422)
      const body = await response.json()
      expect(body.fieldErrors).toMatchObject({
        'customerData.firstName': 'checkout.payPage.validation.nameTooLong',
        'customerData.lastName': 'checkout.payPage.validation.nameTooLong',
      })
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })

  test('discards unsolicited customer data when collection is disabled', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, createFixedTemplateInput({
        status: 'active', collectCustomerDetails: false,
      }))
      linkId = link.id

      const response = await submitPayLink(request, link.slug, {
        customerData: { email: 'invalid', firstName: 'A'.repeat(101), unexpected: 'injected' },
        acceptedLegalConsents: {},
        amount: 49.99,
      })

      expect(response.status()).toBe(201)
      const body = await response.json()
      const transaction = await readCheckoutTransaction(request, token, body.transactionId)
      expect(transaction.customerData ?? {}).toEqual({})
      expect(transaction.email ?? null).toBeNull()
      expect(transaction.firstName ?? null).toBeNull()
      expect(transaction.lastName ?? null).toBeNull()
      expect(transaction.phone ?? null).toBeNull()
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
