import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-UX-008: RecordNotFoundState back-to-list action navigates to the owning list page
 * Source: .ai/specs/implemented/2026-03-23-unified-record-not-found-ui-state.md (Phase 5 — Integration Coverage)
 *
 * Uses the Phase-1 representative page `/backend/customers/companies/[id]`
 * (introduced in PR #2014) to confirm the recovery action actually navigates,
 * not just renders a link with the right href.
 */
test.describe('TC-UX-008: RecordNotFoundState — back-to-list navigation on Phase-1 page', () => {
  test('clicking back-to-list navigates to the companies list', async ({ page }) => {
    await login(page, 'admin')

    const missingId = crypto.randomUUID()
    await page.goto(`/backend/customers/companies/${missingId}`, { waitUntil: 'commit' })

    const notFoundLabel = page.getByText('Company not found', { exact: false })
    await expect(notFoundLabel).toBeVisible({ timeout: 15_000 })

    const backLink = page.getByRole('link', { name: /back to companies/i })
    await expect(backLink).toBeVisible()

    await backLink.click()
    await page.waitForURL('**/backend/customers/companies', { timeout: 15_000 })
    expect(new URL(page.url()).pathname).toBe('/backend/customers/companies')
  })
})
