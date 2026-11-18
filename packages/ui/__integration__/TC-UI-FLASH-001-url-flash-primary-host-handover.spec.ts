/**
 * TC-UI-FLASH-001: URL-driven flash survives a primary-host unmount in a real browser.
 *
 * Follow-up to #9402 / regression guard for #9514. `packages/ui` has no runnable
 * Next.js route (see TC-AI-UI-003's doc comment), so this spec bundles the
 * FlashMessages component with esbuild and serves it from an ephemeral local
 * HTTP server (`serveFlashHandoverHarness.ts`) instead of navigating to a
 * shipped app route — a real Chromium page still mounts the actual component
 * and navigates with a real `?flash=`/`&type=` URL, exercising the same
 * `history.replaceState` + primary-host-election code path the real app uses.
 *
 * Each iteration reloads the page so the component module's singletons
 * (`mountedFlashHostIds`, `pendingFlash`, ...) start from a clean slate —
 * matching how a real full page load behaves.
 */
import { test, expect } from '@playwright/test'
import { serveFlashHandoverHarness, type FlashHandoverHarnessServer } from './support/serveFlashHandoverHarness'

test.describe('FlashMessages URL-flash primary-host handover', () => {
  let harness: FlashHandoverHarnessServer

  test.beforeAll(async () => {
    harness = await serveFlashHandoverHarness()
  })

  test.afterAll(async () => {
    await harness.close()
  })

  for (let iteration = 0; iteration < 10; iteration += 1) {
    test(`iteration ${iteration + 1}: survivor keeps the original expiry, no replay`, async ({ page }) => {
      const message = `Saved-${iteration}`
      await page.goto(`${harness.url}?flash=${message}&type=success`)

      await expect(page.getByText(message)).toHaveCount(1)
      // The URL params must be stripped regardless of which host wins the race.
      expect(new URL(page.url()).search).toBe('')

      await page.waitForTimeout(1500)
      await expect(page.getByText(message)).toHaveCount(1)

      await page.getByTestId('unmount-primary-host').click()
      // Immediately after handover, the surviving host still shows the same toast.
      await expect(page.getByText(message)).toHaveCount(1)

      // Crosses the ORIGINAL 3000ms expiry (1500 + 1600 = 3100ms since showFlash),
      // not a new 3000ms window restarted at handover time.
      await page.waitForTimeout(1600)
      await expect(page.getByText(message)).toHaveCount(0)
    })
  }
})
