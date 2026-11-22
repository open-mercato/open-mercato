import { expect } from '@playwright/test'
import {
  actionNames,
  actionWrite,
  expectActionPersisted,
  nativeKeys,
  observeNotificationEffects,
  openKeyboardNotification,
  test,
} from './helpers/keyboardFixtures'

test.describe('TC-NOTIF-021: Native notification child action keys', () => {
  for (const key of nativeKeys) {
    for (const action of [...actionNames, 'Dismiss'] as const) {
      test(`${key} activates ${action} once without activating the card`, async ({ page, keyboardFixture }) => {
        const card = await openKeyboardNotification(page, keyboardFixture)
        const initialUrl = page.url()
        const effects = observeNotificationEffects(page)
        const endpoint = `/api/notifications/${keyboardFixture.id}/${action === 'Dismiss' ? 'dismiss' : 'action'}`
        const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === endpoint)

        await card.getByRole('button', { name: action, exact: true }).press(key)
        expect((await responsePromise).status()).toBe(200)

        if (action === 'Dismiss') {
          await expect(card).toBeHidden()
          expect(await keyboardFixture.read('dismissed')).toEqual({ ...keyboardFixture.before, status: 'dismissed' })
          await keyboardFixture.expectUnrelatedNotificationUnchanged()
        } else {
          if (action === 'View') {
            await page.waitForURL((url) => `${url.pathname}${url.search}` === keyboardFixture.actionHref)
          } else {
            await expect(card.getByText(`Action taken: ${action}`, { exact: true })).toBeVisible()
          }
          await expectActionPersisted(keyboardFixture, action.toLowerCase())
        }

        expect(effects.writes).toEqual([
          action === 'Dismiss'
            ? { method: 'PUT', path: endpoint, body: null }
            : actionWrite(keyboardFixture, action.toLowerCase()),
        ])
        expect(effects.navigations).toEqual(action === 'View' ? [keyboardFixture.actionHref] : [])
        if (action !== 'View') expect(page.url()).toBe(initialUrl)
        expect(effects.pageErrors).toEqual([])
      })
    }
  }
})
