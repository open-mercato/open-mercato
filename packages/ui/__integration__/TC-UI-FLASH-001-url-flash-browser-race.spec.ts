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

const CLOCK_START = new Date('2026-01-01T00:00:00Z')
const CLOCK_PAUSED_AT = new Date('2026-01-01T01:00:00Z')
const FLASH_DISMISS_MS = 3_000

// React schedules commits through `MessageChannel`, which Playwright's clock
// does not fake. Two round trips through a fresh channel queue behind any
// render React already scheduled, so state changes caused by a fired fake
// timer are committed to the DOM before the next assertion reads it.
async function settleReactCommits(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let hop = 0; hop < 2; hop += 1) {
      await new Promise<void>((resolve) => {
        const channel = new MessageChannel()
        channel.port1.onmessage = () => {
          channel.port1.close()
          resolve()
        }
        channel.port2.postMessage(null)
      })
    }
  })
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

    // The page's timers run on a Playwright-controlled clock: it flows
    // naturally while the harness loads, then is paused, so every deferred
    // navigation observer and the 3s dismiss timer fire only when the test
    // explicitly advances time. That pins the expiry boundary exactly,
    // independent of CI scheduler jitter or CDP round-trip latency.
    await page.clock.install({ time: CLOCK_START })
    await page.goto(harness.url)
    await page.waitForFunction(() => Boolean(window.__flashRaceHarness))
    await page.clock.pauseAt(CLOCK_PAUSED_AT)
    // `showFlash` (which schedules the 3s dismiss timer) runs as a direct
    // listener of the same `flash` DOM event this records against, so this
    // captures the fake-clock instant the dismiss timer started.
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
      // Fire the primary host's deferred (`setTimeout(…, 0)`) navigation
      // observer only now, after the secondary host has synchronously mounted.
      await page.clock.runFor(1)

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
      if (attempt < attempts) {
        await page.evaluate(() => window.__flashRaceHarness!.unmountSecondary())
      }
    }

    // Auto-dismiss boundary on the paused clock: advance to 1ms before the
    // 3s deadline (measured from the instant the last toast was delivered),
    // let React commit whatever that produced, and assert the toast is still
    // shown; then advance through the deadline and assert it is gone. With
    // the clock paused no later timer can fire on its own, so a dismiss delay
    // longer than 3s fails the final assertion instead of being retried into
    // a pass.
    const toast = page.getByText(lastMessage)
    const { shownAt, now } = await page.evaluate(() => ({
      shownAt: window.__lastFlashShownAt!,
      now: Date.now(),
    }))
    await page.clock.runFor(shownAt + FLASH_DISMISS_MS - 1 - now)
    await settleReactCommits(page)
    await expect(toast).toHaveCount(1)
    await page.clock.runFor(2)
    await settleReactCommits(page)
    await expect(toast).toHaveCount(0)
  })
})
