import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-UX-007: RecordNotFoundState renders for a missing sales document detail
 * Source: .ai/specs/2026-03-23-unified-record-not-found-ui-state.md (Phase 5 — Integration Coverage)
 *
 * The sales documents detail page is backed by a list API that returns an
 * empty `items` array when the requested id does not exist (not an HTTP 404).
 * This test exercises that branch: a stale/random id should render the shared
 * `RecordNotFoundState` instead of the detail form.
 */
test.describe('TC-UX-007: RecordNotFoundState — sales document detail with stale id', () => {
  test('renders shared not-found state and back-to-list action for an unknown document', async ({ page }) => {
    await login(page, 'admin')

    const staleId = crypto.randomUUID()
    await page.goto(`/backend/sales/documents/${staleId}`, { waitUntil: 'commit' })

    const notFoundLabel = page.getByText('Document not found', { exact: false })
    await expect(notFoundLabel).toBeVisible({ timeout: 15_000 })

    const backLink = page.getByRole('link', { name: /back to quotes/i })
    await expect(backLink).toBeVisible()
    await expect(backLink).toHaveAttribute('href', '/backend/sales/quotes')
  })

  test('renders order-scoped back link when kind=order is supplied', async ({ page }) => {
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
