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

test.describe('TC-CHKT-018: Transaction detail without PII', () => {
  test('masks customer fields for a user without checkout.viewPii', async ({ request }) => {
    let adminToken: string | null = null
    let employeeToken: string | null = null
    let linkId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      employeeToken = await getAuthToken(request, 'employee')
      const link = await createLinkFixture(request, adminToken, {
        ...createFixedTemplateInput({ status: 'active' }),
      })
      linkId = link.id

      const response = await submitPayLink(request, link.slug, {
        customerData: createCustomerData(),
        acceptedLegalConsents: {},
        amount: 49.99,
      })
      expect(response.status()).toBe(201)

      const body = await response.json()
      const detail = await readCheckoutTransaction(request, employeeToken, body.transactionId)
      expect(detail.email).toBeNull()
      expect(detail.firstName).toBeNull()
      expect(detail.lastName).toBeNull()
      expect(detail.customerData).toBeNull()
    } finally {
      await deleteCheckoutEntityIfExists(request, adminToken, 'links', linkId)
    }
  })
})
