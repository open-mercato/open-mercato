import { expect } from '@playwright/test'
import {
  nativeKeys,
  observeNotificationEffects,
  openKeyboardNotification,
  test,
} from './helpers/keyboardFixtures'

test.describe('TC-NOTIF-024: Direct notification card keys', () => {
  for (const key of nativeKeys) {
    test(`${key} reads and opens the card without executing a child action`, async ({ page, keyboardFixture }) => {
      const card = await openKeyboardNotification(page, keyboardFixture)
      const effects = observeNotificationEffects(page)
      const initialUrl = page.url()

      await card.press('ArrowDown')
      await card.press('a')
      expect(await keyboardFixture.read()).toEqual(keyboardFixture.before)
      expect(effects.writes).toEqual([])
      expect(effects.navigations).toEqual([])
      expect(page.url()).toBe(initialUrl)

      const endpoint = `/api/notifications/${keyboardFixture.id}/read`
      const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === endpoint)
      await card.press(key)
      expect((await responsePromise).status()).toBe(200)
      await page.waitForURL((url) => `${url.pathname}${url.search}` === keyboardFixture.parentHref)
      const after = await keyboardFixture.read()
      expect(after).toEqual({ ...keyboardFixture.before, status: 'read', readAt: expect.any(String) })
      expect(Number.isFinite(Date.parse(String(after.readAt)))).toBe(true)
      await keyboardFixture.expectUnrelatedNotificationUnchanged()
      expect(effects.writes).toEqual([{ method: 'PUT', path: endpoint, body: null }])
      expect(effects.navigations).toEqual([keyboardFixture.parentHref])
      expect(effects.pageErrors).toEqual([])
    })
  }
})
