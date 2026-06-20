import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-UX-007: RecordNotFoundState renders for a missing sales document detail (default kind → quotes)
 * Source: .ai/specs/implemented/2026-03-23-unified-record-not-found-ui-state.md (Phase 5 — Integration Coverage)
 *
 * The sales documents detail page is backed by a list API that returns an
 * empty `items` array when the requested id does not exist (not an HTTP 404).
 * This test exercises that branch with no `kind` query parameter, so the
 * back-to-list action should point at the quotes list.
 */
test.describe('TC-UX-007: RecordNotFoundState — sales document detail with stale id (default kind)', () => {
  test('renders shared not-found state and back-to-quotes action for an unknown document', async ({ page }) => {
    await login(page, 'admin')

    const staleId = crypto.randomUUID()
    await page.goto(`/backend/sales/documents/${staleId}`, { waitUntil: 'commit' })

    const notFoundLabel = page.getByText('Document not found', { exact: false })
    await expect(notFoundLabel).toBeVisible({ timeout: 15_000 })

    const backLink = page.getByRole('link', { name: /back to quotes/i })
    await expect(backLink).toBeVisible()
    await expect(backLink).toHaveAttribute('href', '/backend/sales/quotes')
  })
})
