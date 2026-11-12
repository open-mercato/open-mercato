import { expect } from '@playwright/test'
import {
  actionNames,
  actionWrite,
  expectActionPersisted,
  observeNotificationEffects,
  openKeyboardNotification,
  test,
} from './helpers/keyboardFixtures'

test.describe('TC-NOTIF-022: Pending notification actions suppress duplicate submissions', () => {
  for (const input of ['keyboard', 'mouse'] as const) {
    test(`repeated ${input} input sends one action while pending`, async ({ page, keyboardFixture }) => {
      const card = await openKeyboardNotification(page, keyboardFixture)
      const approve = card.getByRole('button', { name: 'Approve', exact: true })
      const effects = observeNotificationEffects(page)
      const initialUrl = page.url()
      const endpoint = `/api/notifications/${keyboardFixture.id}/action`
      let releaseRequest = () => {}
      const pending = new Promise<void>((resolve) => { releaseRequest = resolve })
      const routePattern = `**${endpoint}`
      await page.route(routePattern, async (route) => {
        await pending
        await route.continue()
      })

      try {
        const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === endpoint)
        if (input === 'keyboard') {
          await approve.press('Enter')
        } else {
          await approve.dblclick()
        }
        await expect.poll(() => effects.writes).toEqual([actionWrite(keyboardFixture, 'approve')])
        for (const action of actionNames) {
          await expect(card.getByRole('button', { name: action, exact: true })).toBeDisabled()
        }
        await page.keyboard.press('Enter')
        await page.keyboard.press('Space')
        expect(await keyboardFixture.read()).toEqual(keyboardFixture.before)
        expect(effects.writes).toEqual([actionWrite(keyboardFixture, 'approve')])

        releaseRequest()
        expect((await responsePromise).status()).toBe(200)
        await expect(card.getByText('Action taken: Approve', { exact: true })).toBeVisible()
        await expectActionPersisted(keyboardFixture, 'approve')
        expect(effects.writes).toEqual([actionWrite(keyboardFixture, 'approve')])
        expect(effects.navigations).toEqual([])
        expect(page.url()).toBe(initialUrl)
        expect(effects.pageErrors).toEqual([])
      } finally {
        releaseRequest()
        await page.unroute(routePattern)
      }
    })
  }
})
