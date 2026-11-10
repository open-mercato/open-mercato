import { expect } from '@playwright/test'
import {
  expectActionPersisted,
  notificationMessages,
  openKeyboardNotification,
  test,
} from './helpers/keyboardFixtures'

test.describe('TC-NOTIF-025: Completed action is prominent beside the notification title', () => {
  for (const locale of ['en', 'pl'] as const) {
    for (const action of ['Approve', 'Reject'] as const) {
      test(`${locale} shows ${action} as a title badge after execution and reload`, async ({ page, keyboardFixture }, testInfo) => {
        const card = await openKeyboardNotification(page, keyboardFixture, locale)
        const endpoint = `/api/notifications/${keyboardFixture.id}/action`
        const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === endpoint)
        await card.getByRole('button', { name: action, exact: true }).click()
        expect((await responsePromise).status()).toBe(200)
        const label = notificationMessages[locale]['notifications.actionTaken'].replace('{action}', action)
        const badge = card.getByText(label, { exact: true })
        await expect(badge).toBeVisible()
        await expect(badge).toHaveAttribute('data-slot', 'badge')
        await expect(badge.locator('..')).toContainText(keyboardFixture.title)
        await expect(card.getByRole('button', { name: action, exact: true })).toHaveCount(0)
        await expectActionPersisted(keyboardFixture, action.toLowerCase())

        const restoredCard = await openKeyboardNotification(page, keyboardFixture, locale)
        const restoredBadge = restoredCard.getByText(label, { exact: true })
        await expect(restoredBadge).toHaveAttribute('data-slot', 'badge')
        await expect(restoredBadge.locator('..')).toContainText(keyboardFixture.title)
        await testInfo.attach('completed-action', { body: await page.screenshot(), contentType: 'image/png' })
      })
    }
  }
})
