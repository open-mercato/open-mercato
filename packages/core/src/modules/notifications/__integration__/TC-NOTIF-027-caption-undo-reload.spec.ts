import { expect, type Page } from '@playwright/test'
import {
  expectActionPersisted,
  notificationMessages,
  openKeyboardNotification,
  test,
} from './helpers/keyboardFixtures'

const shortLabelKey = 'notifications.actions.markRead'
const longLabelKey = 'notifications.settings.types.description'

for (const locale of ['en', 'pl'] as const) {
  for (const caption of ['short', 'long'] as const) {
    test.describe(`TC-NOTIF-027: ${locale} ${caption} caption survives Undo and reload`, () => {
      const actionId = 'translated_action'
      const labelKey = caption === 'short' ? shortLabelKey : longLabelKey
      const label = notificationMessages[locale][labelKey]
      test.use({
        viewport: { width: 390, height: 844 },
        keyboardActions: [{ id: actionId, label: 'Untranslated fallback', labelKey }],
      })

      test('keeps the descriptive translated caption and never offers the completed action again', async ({ page, keyboardFixture }, testInfo) => {
        const messages = notificationMessages[locale]
        const captionText = messages['notifications.actionTaken'].replace('{action}', label)
        let card = await openKeyboardNotification(page, keyboardFixture, locale)
        const actionResponse = page.waitForResponse((response) =>
          new URL(response.url()).pathname === `/api/notifications/${keyboardFixture.id}/action`
          && response.request().method() === 'POST',
        )
        await card.getByRole('button', { name: label, exact: true }).click()
        expect((await actionResponse).status()).toBe(200)

        const assertCaption = async () => {
          await expect(card.getByText(captionText, { exact: true })).toBeVisible()
          await expect(card.getByRole('button', { name: label, exact: true })).toHaveCount(0)
          await expect(card).not.toContainText(actionId)
          await expect(card).not.toContainText('Untranslated fallback')
          await expectActionPersisted(keyboardFixture, actionId)
          const badge = card.getByText(captionText, { exact: true })
          expect(await badge.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        }
        const reloadCard = async (currentPage: Page) => {
          await currentPage.reload()
          const unreadLabel = new RegExp(`^${messages['notifications.badge.unread'].replace('{count}', '\\d+')}$`)
          await currentPage.getByRole('button', { name: unreadLabel }).click()
          return currentPage.getByRole('dialog', { name: messages['notifications.title'], exact: true })
            .getByRole('button').filter({ has: currentPage.getByText(keyboardFixture.title, { exact: true }) })
        }

        await assertCaption()
        card = await reloadCard(page)
        await assertCaption()

        const dismissed = page.waitForResponse((response) =>
          new URL(response.url()).pathname === `/api/notifications/${keyboardFixture.id}/dismiss`,
        )
        await card.getByRole('button', { name: messages['notifications.actions.dismiss'], exact: true }).click()
        expect((await dismissed).status()).toBe(200)
        await expect(card).toHaveCount(0)
        expect(await keyboardFixture.read('dismissed')).toMatchObject({ status: 'dismissed', actionTaken: actionId })

        const restored = page.waitForResponse((response) =>
          new URL(response.url()).pathname === `/api/notifications/${keyboardFixture.id}/restore`,
        )
        await page.getByRole('dialog', { name: messages['notifications.title'], exact: true })
          .getByRole('button', { name: messages['notifications.actions.undo'], exact: true }).click()
        expect((await restored).status()).toBe(200)
        await assertCaption()
        card = await reloadCard(page)
        await assertCaption()
        await testInfo.attach('caption-after-undo-reload', { body: await page.screenshot(), contentType: 'image/png' })
      })
    })
  }
}
