import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCheckoutClientHeaders,
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
} from './helpers/fixtures'

test.describe('TC-CHKT-031 (wrappers): Pay page section wrapper/replacement handle can customize summary/help area without changing payment integrity', () => {
  test('renders the example summary/help wrappers and still completes a payment successfully', async ({ page, request }) => {
    test.skip(
      process.env.NEXT_PUBLIC_OM_EXAMPLE_CHECKOUT_TEST_INJECTIONS_ENABLED !== 'true',
      'Example checkout wrapper overrides are disabled in this test environment.',
    )

    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({
          status: 'active',
          collectCustomerDetails: false,
        }),
      })
      linkId = link.id

      await page.context().setExtraHTTPHeaders(createCheckoutClientHeaders())
      await page.goto(`/pay/${encodeURIComponent(link.slug)}`)

      await expect(page.getByTestId('example-checkout-summary-wrapper')).toBeVisible()
      await expect(page.getByTestId('example-checkout-help-wrapper')).toBeVisible()

      await page.getByRole('button', { name: /pay now/i }).click()
      await page.waitForURL(new RegExp(`/pay/${link.slug}/success/`))
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
