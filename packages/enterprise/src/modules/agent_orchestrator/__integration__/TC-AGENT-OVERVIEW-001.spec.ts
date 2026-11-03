import { expect, test, type Page } from '@playwright/test'

/**
 * TC-AGENT-OVERVIEW-001: no overview panel hides content behind its own border.
 * Source: the Agent trust card shipped a four-column table inside a 2/5-width
 * panel. Under the default `table-auto` layout the table sized itself to its
 * longest agent id (620px inside a 449px panel) and the panel's `overflow-hidden`
 * cut the Status column off — 178px of it at 1440, 242px at 1280 — with no
 * scrollbar to reveal what was missing. The `truncate` classes in the agent cell
 * had been written for exactly this and never engaged.
 *
 * Asserts the general property rather than that one card: a container that hides
 * its overflow must not be hiding anything, at the two widths the backend shell
 * is actually used at.
 *
 * Read-only: no fixtures, nothing to clean up.
 */

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}

for (const width of [1280, 1440]) {
  test.describe(`TC-AGENT-OVERVIEW-001: overview panels at ${width}px`, () => {
    test('no clipped table content', async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await loginAsAdmin(page)
      await page.goto('/backend/overview', { waitUntil: 'domcontentloaded' })
      await expect(page.getByText('Agent trust').first()).toBeVisible({ timeout: 20_000 })

      const clipped = await page.evaluate(() => {
        const offenders: Array<{ text: string; hiddenPx: number }> = []
        for (const element of Array.from(document.querySelectorAll('div'))) {
          const style = getComputedStyle(element)
          const hidesX = style.overflowX === 'hidden' || style.overflow === 'hidden'
          // A `truncate` element hides text on purpose and carries a `title`
          // to give it back; that is not the defect this guards.
          const isDeliberateTruncation = element.className.toString().includes('truncate')
          if (hidesX && !isDeliberateTruncation && element.scrollWidth > element.clientWidth + 1) {
            offenders.push({
              text: (element.textContent ?? '').trim().slice(0, 60),
              hiddenPx: element.scrollWidth - element.clientWidth,
            })
          }
        }
        return offenders
      })

      expect(clipped, 'a panel is hiding content with no way to scroll to it').toEqual([])
    })
  })
}
