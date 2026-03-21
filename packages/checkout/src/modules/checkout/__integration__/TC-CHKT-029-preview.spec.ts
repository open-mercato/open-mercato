import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
} from './helpers/fixtures'

test.describe('TC-CHKT-029 (preview): Admin preview of draft link renders pay page', () => {
  test('shows the preview banner and draft pay-page content for an authenticated admin', async ({ page, request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({
          status: 'draft',
          title: 'QA preview link',
          collectCustomerDetails: false,
        }),
      })
      linkId = link.id

      await login(page, 'admin')
      await page.goto(`/pay/${encodeURIComponent(link.slug)}?preview=true`)

      await expect(page.getByText(/preview mode\. payments are disabled\./i)).toBeVisible()
      await expect(page.getByRole('heading', { name: 'QA preview link' })).toBeVisible()
      await expect(page.getByRole('button', { name: /preview only/i })).toBeDisabled()
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
