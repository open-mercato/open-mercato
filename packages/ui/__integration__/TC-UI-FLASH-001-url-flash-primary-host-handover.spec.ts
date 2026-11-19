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
 * The final assertion reads the toast's presence with a single, non-retrying
 * `locator.count()` right after crossing the ORIGINAL 3000ms expiry, instead
 * of the default retrying `toHaveCount` matcher (20s assertion timeout): a
 * retrying matcher would still pass even if handover incorrectly restarted
 * the dismiss timer, because it simply keeps polling real time until the
 * reset timer also fires (~4500ms) within its own 20s budget. A single
 * snapshot read at ~3200ms — comfortably past the original deadline but well
 * short of a reset one — fails for real if handover ever resets the timer.
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

      // Cross the ORIGINAL 3000ms expiry (1500 + 1700 = 3200ms since showFlash), well
      // short of a fresh 3000ms window restarted at the ~1500ms handover (~4500ms).
      await page.waitForTimeout(1700)
      // A single, non-retrying read: the retrying `toHaveCount` matcher used above
      // would still pass a reset-timer regression by polling for the extra ~1300ms
      // the reset deadline needs, inside its own 20s assertion timeout.
      const survivingCount = await page.getByText(message).count()
      expect(survivingCount).toBe(0)
    })
  }
})
