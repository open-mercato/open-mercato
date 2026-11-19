import { expect, test, type Page } from '@playwright/test'
import type { FlashRaceHarness } from './flash-race/harnessApp'
import {
  startFlashRaceHarnessServer,
  type FlashRaceHarnessServer,
} from './flash-race/startFlashRaceHarnessServer'

declare global {
  interface Window {
    __flashRaceHarness?: FlashRaceHarness
    __lastFlashShownAt?: number
  }
}

async function runLateSecondaryRace(
  page: Page,
  message: string,
  keepValue: string,
): Promise<void> {
  await page.evaluate(
    ({ message: flashMessage, keepValue: keep }) => {
      const url = new URL(window.location.href)
      url.search = ''
      url.hash = ''
      url.searchParams.set('flash', flashMessage)
      url.searchParams.set('type', 'success')
      url.searchParams.set('keep', keep)
      window.__flashRaceHarness!.navigate(`${url.pathname}?${url.searchParams.toString()}#frag-${keep}`)
      // Mounting the secondary host in the same synchronous turn as the URL
      // update reproduces the race from #8471/#8709: the secondary's own
      // mount-time effect observes the just-written URL before the primary
      // host's deferred navigation-observer effect (scheduled off the
      // monkey-patched `pushState` via `setTimeout`+`queueMicrotask`) has
      // had a chance to run. `mountSecondary` commits synchronously (the
      // harness wraps it in `flushSync`), so the ordering below is
      // guaranteed, not merely hoped for.
      window.__flashRaceHarness!.mountSecondary()
      if (!window.location.search.includes('flash=')) {
        throw new Error(
          'Harness ordering assumption violated: the primary host already ' +
            'consumed/stripped the URL flash params before the secondary ' +
            'host finished mounting synchronously — this run would not ' +
            'actually exercise the late-secondary-mount race.',
        )
      }
    },
    { message, keepValue },
  )
}

/**
 * TC-UI-FLASH-001: regression for #8471/#8685, automated per #8709.
 *
 * #8685 fixed a swallowed-toast bug by gating FlashMessages' URL-reading
 * effect on `isPrimaryHost`, so only the first-mounted host ever consumes
 * `?flash=`. The existing jsdom/RTL regression in `FlashMessages.test.tsx`
 * covers that fix at the unit level. This spec automates the same
 * late-secondary-mount race in a real browser, as requested in the
 * #8685 follow-up QA comment and tracked by #8709.
 *
 * The two-host harness mounts the real `FlashMessages` component (not a
 * stand-in) via a throwaway esbuild bundle served outside both
 * `apps/mercato` and this package's shipped `src/`/`dist` output — see
 * `flash-race/startFlashRaceHarnessServer.ts`.
 */
test.describe('TC-UI-FLASH-001: FlashMessages late-secondary URL flash race (browser)', () => {
  let harness: FlashRaceHarnessServer

  test.beforeAll(async () => {
    harness = await startFlashRaceHarnessServer()
  })

  test.afterAll(async () => {
    await harness.close()
  })

  test('shows exactly one toast via the primary host across ten late-secondary races, then expires after 3s', async ({ page }) => {
    test.slow()

    await page.goto(harness.url)
    await page.waitForFunction(() => Boolean(window.__flashRaceHarness))
    // `showFlash` (which schedules the 3s dismiss timer) runs as a direct
    // listener of the same `flash` DOM event this records against — both
    // fire synchronously in the same turn, so this captures the exact
    // instant the dismiss timer started. The expiry check below anchors to
    // this timestamp rather than to "now" at that point in the test, so the
    // toast/URL assertions and the unmount round trip in between can take
    // however long they take without eating into the 3s margin.
    await page.evaluate(() => {
      window.addEventListener('flash', () => {
        window.__lastFlashShownAt = Date.now()
      })
    })

    const attempts = 10
    let lastMessage = ''

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const message = `Race flash ${attempt}`
      const keep = `k${attempt}`
      lastMessage = message

      await runLateSecondaryRace(page, message, keep)

      const toasts = page.locator('[data-slot="alert"]')
      await expect(toasts).toHaveCount(1)
      await expect(toasts.first()).toContainText(message)

      // The toast only renders after the same effect that strips `flash`/
      // `type` and rewrites the URL, so by this point the rewrite is done.
      const currentUrl = page.url()
      expect(currentUrl).not.toContain('flash=')
      expect(currentUrl).not.toContain('type=')
      expect(currentUrl).toContain(`keep=${keep}`)
      expect(currentUrl.endsWith(`#frag-${keep}`)).toBe(true)

      // Unmount the secondary before the next iteration so the following
      // race exercises a genuinely fresh "late" mount, not a no-op update.
      await page.evaluate(() => window.__flashRaceHarness!.unmountSecondary())
    }

    // Deterministic 3-second auto-dismiss boundary, anchored to the exact
    // instant the last toast appeared (captured via the `flash` event
    // listener above) rather than to "now" at this point in the test — the
    // preceding toast/URL assertions and the unmount round trip already
    // consumed an unknown amount of real time, so computing the remaining
    // wait relative to the actual anchor (instead of a fixed offset from
    // here) keeps the two checks pinned to "just before" and "just after"
    // the real 3s boundary regardless of how long those steps took.
    const toastShownAt = await page.evaluate(() => window.__lastFlashShownAt!)
    const elapsedBeforeFirstCheck = (await page.evaluate(() => Date.now())) - toastShownAt
    await page.waitForTimeout(Math.max(0, 2_999 - elapsedBeforeFirstCheck))
    await expect(page.getByText(lastMessage)).toBeVisible()
    const elapsedBeforeSecondCheck = (await page.evaluate(() => Date.now())) - toastShownAt
    await page.waitForTimeout(Math.max(0, 3_001 - elapsedBeforeSecondCheck))
    await expect(page.getByText(lastMessage)).toHaveCount(0)
  })
})
