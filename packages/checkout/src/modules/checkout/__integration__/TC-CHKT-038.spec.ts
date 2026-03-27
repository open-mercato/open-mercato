import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createNotificationFixture,
  dismissNotificationIfExists,
} from '@open-mercato/core/helpers/integration/notificationsFixtures'
import {
  createCustomerData,
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  submitPayLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-038: Notification panel blocks background scroll and closes after checkout navigation', () => {
  test('locks body scroll while open and closes after navigating from a checkout notification', async ({ page, request }) => {
    let token: string | null = null
    let linkId: string | null = null
    let notificationId: string | null = null

    try {
      token = await getAuthToken(request, 'superadmin')
      const scope = getTokenScope(token)
      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({ status: 'active' }),
      })
      linkId = link.id

      const submitResponse = await submitPayLink(request, link.slug, {
        customerData: createCustomerData(),
        acceptedLegalConsents: {},
        amount: 49.99,
      })
      expect(submitResponse.status()).toBe(201)
      const submitBody = await submitResponse.json()
      expect(typeof submitBody.transactionId).toBe('string')
      const transactionId = submitBody.transactionId as string

      const notificationTitle = `Checkout notification ${Date.now()}`
      notificationId = await createNotificationFixture(request, token, {
        recipientUserId: scope.userId,
        type: 'checkout.transaction.completed',
        title: notificationTitle,
        bodyVariables: {
          amount: '49.99',
          currency: 'USD',
        },
        sourceEntityType: 'checkout:checkout_transaction',
        sourceEntityId: transactionId,
        linkHref: `/backend/checkout/transactions/${transactionId}`,
      })

      await login(page, 'superadmin')
      await page.goto('/backend')

      const notificationsButton = page.getByRole('button', { name: /notifications/i })
      await expect(notificationsButton).toBeVisible()
      await notificationsButton.click()

      const notificationsDialog = page.getByRole('dialog', { name: /notifications/i })
      await expect(notificationsDialog).toBeVisible()
      await expect(notificationsDialog.getByText(notificationTitle)).toBeVisible()
      await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')

      await notificationsDialog.getByRole('button', { name: /view transaction/i }).first().click()

      await expect(page).toHaveURL(new RegExp(`/backend/checkout/transactions/${transactionId}$`))
      await expect(notificationsDialog).toHaveCount(0)
      await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
    } finally {
      await dismissNotificationIfExists(request, token, notificationId)
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
