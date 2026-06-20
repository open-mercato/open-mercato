import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-UX-006: RecordNotFoundState renders for a missing person detail
 * Source: .ai/specs/implemented/2026-03-23-unified-record-not-found-ui-state.md (Phase 5 — Integration Coverage)
 *
 * Verifies:
 * - Navigating to `/backend/customers/people/<random-uuid>` renders the shared
 *   `RecordNotFoundState` instead of the detail form.
 * - The "Back to people" recovery action is visible.
 * - No CrudForm submit control is rendered on the not-found page.
 */
test.describe('TC-UX-006: RecordNotFoundState — people detail with non-existent UUID', () => {
  test('renders shared not-found state and back-to-list action', async ({ page }) => {
    await login(page, 'admin')

    const missingId = crypto.randomUUID()
    await page.goto(`/backend/customers/people/${missingId}`, { waitUntil: 'commit' })

    const notFoundLabel = page.getByText('Person not found', { exact: false })
    await expect(notFoundLabel).toBeVisible({ timeout: 15_000 })

    const backLink = page.getByRole('link', { name: /back to people/i })
    await expect(backLink).toBeVisible()
    await expect(backLink).toHaveAttribute('href', '/backend/customers/people')

    await expect(page.getByRole('button', { name: /^save$/i })).toHaveCount(0)
  })
})
