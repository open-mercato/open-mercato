import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-UX-009: RecordNotFoundState renders order-scoped back link when kind=order is supplied
 * Source: .ai/specs/2026-03-23-unified-record-not-found-ui-state.md (Phase 5 — Integration Coverage)
 *
 * Sibling of TC-UX-007: verifies that the sales documents detail page renders
 * the shared `RecordNotFoundState` with an orders-scoped recovery action when
 * the `?kind=order` query parameter is supplied. The page chooses the back
 * link target based on `searchParams.get('kind')`, so this case proves the
 * kind-aware branch independently from the default (quotes) case.
 */
test.describe('TC-UX-009: RecordNotFoundState — sales document detail with stale id (kind=order)', () => {
  test('renders shared not-found state and back-to-orders action when kind=order is supplied', async ({ page }) => {
    await login(page, 'admin')

    const staleId = crypto.randomUUID()
    await page.goto(`/backend/sales/documents/${staleId}?kind=order`, { waitUntil: 'commit' })

    const notFoundLabel = page.getByText('Document not found', { exact: false })
    await expect(notFoundLabel).toBeVisible({ timeout: 15_000 })

    const backLink = page.getByRole('link', { name: /back to orders/i })
    await expect(backLink).toBeVisible()
    await expect(backLink).toHaveAttribute('href', '/backend/sales/orders')
  })
})
