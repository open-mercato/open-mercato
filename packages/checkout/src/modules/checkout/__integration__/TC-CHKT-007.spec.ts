import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  readLink,
  updateLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-007: Update link, verify changes', () => {
  test('updates editable link fields before the first transaction', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({ status: 'draft' }),
      })
      linkId = link.id

      const response = await updateLink(request, token, link.id, {
        name: 'QA updated link',
        title: 'QA updated link title',
        fixedPriceAmount: 77.25,
      })
      expect(response.ok()).toBeTruthy()

      const updated = await readLink(request, token, link.id)
      expect(updated.name).toBe('QA updated link')
      expect(updated.title).toBe('QA updated link title')
      expect(updated.fixedPriceAmount).toBe(77.25)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
