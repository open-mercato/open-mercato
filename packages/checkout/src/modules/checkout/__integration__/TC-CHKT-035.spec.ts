import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCheckoutClientHeaders,
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  readCheckoutTransaction,
} from './helpers/fixtures'

test.describe('TC-CHKT-035: Terms/privacy links open popup with sanitized markdown content and accepted proof is stored on transaction', () => {
  test('opens the legal-document modal, keeps unsafe markdown inert, and persists consent proof on the transaction', async ({ page, request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({
          status: 'active',
          collectCustomerDetails: false,
          legalDocuments: {
            terms: {
              title: 'Terms of Service',
              markdown: '<script>window.__checkoutTermsInjected = true</script>\n\n**Keep this safe**',
              required: true,
            },
            privacyPolicy: {
              title: 'Privacy Policy',
              markdown: 'We only use your data for this checkout.',
              required: true,
            },
          },
        }),
      })
      linkId = link.id

      await page.context().setExtraHTTPHeaders(createCheckoutClientHeaders())
      await page.goto(`/pay/${encodeURIComponent(link.slug)}`)
      await page.getByRole('button', { name: /read document/i }).first().click()

      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible()
      await expect(page.getByText('Keep this safe')).toBeVisible()
      expect(await page.evaluate(() => (window as Window & { __checkoutTermsInjected?: boolean }).__checkoutTermsInjected ?? null)).toBeNull()
      await page.getByRole('button', { name: /close/i }).click()
      await expect(page.getByRole('dialog')).toBeHidden()

      await page.locator('input[type="checkbox"]').nth(0).check()
      await page.locator('input[type="checkbox"]').nth(1).check()
      await page.getByRole('button', { name: /pay now/i }).click()
      await page.waitForURL(new RegExp(`/pay/${link.slug}/success/`))

      const transactionId = page.url().split('/').pop()
      expect(transactionId).toBeTruthy()

      const transaction = await readCheckoutTransaction(request, token, transactionId!)
      expect(transaction.acceptedLegalConsents).toMatchObject({
        terms: {
          title: 'Terms of Service',
          required: true,
          markdownHash: expect.any(String),
          acceptedAt: expect.any(String),
        },
        privacyPolicy: {
          title: 'Privacy Policy',
          required: true,
          markdownHash: expect.any(String),
          acceptedAt: expect.any(String),
        },
      })
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
