import { expect } from '@playwright/test'
import {
  actionNames,
  actionWrite,
  expectActionPersisted,
  notificationMessages,
  observeNotificationEffects,
  openKeyboardNotification,
  test,
} from './helpers/keyboardFixtures'

test.describe('TC-NOTIF-023: Translated notification transport failure and native retry', () => {
  for (const locale of ['en', 'pl'] as const) {
    test(`${locale} shows a transport error and permits a successful retry`, async ({ page, keyboardFixture }) => {
      const card = await openKeyboardNotification(page, keyboardFixture, locale)
      const approve = card.getByRole('button', { name: 'Approve', exact: true })
      const effects = observeNotificationEffects(page)
      const initialUrl = page.url()
      const endpoint = `/api/notifications/${keyboardFixture.id}/action`
      const routePattern = `**${endpoint}`
      const errorText = notificationMessages[locale]['notifications.error.action']
      await page.route(routePattern, (route) => route.abort('failed'))

      try {
        await approve.press(locale === 'en' ? 'Enter' : 'Space')
        await expect(page.getByText(errorText, { exact: true })).toBeVisible()
        for (const action of actionNames) {
          await expect(card.getByRole('button', { name: action, exact: true })).toBeEnabled()
        }
        expect(await keyboardFixture.read()).toEqual(keyboardFixture.before)
        await keyboardFixture.expectUnrelatedNotificationUnchanged()
        expect(effects.writes).toEqual([actionWrite(keyboardFixture, 'approve')])
        expect(effects.navigations).toEqual([])
        expect(page.url()).toBe(initialUrl)
        expect(effects.pageErrors).toEqual([])
      } finally {
        await page.unroute(routePattern)
      }

      const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === endpoint)
      await approve.press(locale === 'en' ? 'Space' : 'Enter')
      expect((await responsePromise).status()).toBe(200)
      const caption = notificationMessages[locale]['notifications.actionTaken'].replace('{action}', 'Approve')
      await expect(card.getByText(caption, { exact: true })).toBeVisible()
      await expectActionPersisted(keyboardFixture, 'approve')
      expect(effects.writes).toEqual([actionWrite(keyboardFixture, 'approve'), actionWrite(keyboardFixture, 'approve')])
      expect(effects.navigations).toEqual([])
      expect(page.url()).toBe(initialUrl)
      expect(effects.pageErrors).toEqual([])
    })
  }
})
