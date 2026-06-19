import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { extractOperation, skipIfUndoTestsDisabled } from '@open-mercato/core/helpers/integration/undoHarness'
import {
  createCustomerData,
  createFixedTemplateInput,
  createLinkFixture,
  createTemplateFixture,
  deleteCheckoutEntityIfExists,
  submitPayLink,
} from './helpers/fixtures'

/**
 * TC-UNDO-001 (§4 checkout) — non-undoable commands expose no undo affordance.
 *
 * Public checkout submissions create a CheckoutTransaction via the `checkout.transaction.*`
 * commands, which are intentionally NOT undoable (financial events). The mutating response
 * must therefore carry no `x-om-operation` undo envelope: `extractOperation(res) === null`.
 */

test.describe('TC-UNDO-001 checkout §4 — non-undoable commands expose no undo token', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('public checkout submit creates a transaction with no undo token', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let templateId: string | null = null
    let linkId: string | null = null
    try {
      templateId = await createTemplateFixture(request, token, createFixedTemplateInput({ status: 'draft' }))
      const link = await createLinkFixture(request, token, createFixedTemplateInput({ status: 'active', templateId }))
      linkId = link.id

      const submitRes = await submitPayLink(request, link.slug, {
        customerData: createCustomerData(),
        acceptedLegalConsents: {},
        amount: 49.99,
      })
      expect(submitRes.status(), `submit status ${submitRes.status()}`).toBe(201)

      expect(
        extractOperation(submitRes),
        'a financial checkout submit must expose no undo token (§4)',
      ).toBeNull()
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
    }
  })
})
