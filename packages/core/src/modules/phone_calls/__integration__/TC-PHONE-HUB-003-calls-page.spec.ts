import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-PHONE-HUB-003 — the backend call list renders its shell and empty state.
 *
 * The list is read-only, so the empty state is the state a tenant sees until a provider
 * ingests something. Its copy is deliberately provider-neutral ("once they are ingested
 * from a provider") because webhooks will feed the same table later — asserting the copy
 * guards that decision against a well-meaning rewrite to "after pull".
 */
test.describe('TC-PHONE-HUB-003: phone calls backend page', () => {
  test('renders the list shell, columns and empty state', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/phone_calls')

    await expect(page.getByRole('heading', { name: 'Phone Calls' })).toBeVisible()

    for (const column of ['Call ID', 'Direction', 'Status', 'Provider', 'Started', 'Duration', 'Ingest']) {
      await expect(page.getByRole('columnheader', { name: column })).toBeVisible()
    }

    await expect(
      page.getByText('No phone calls yet. Calls appear here once they are ingested from a provider.'),
    ).toBeVisible()

    await expect(page.getByPlaceholder('Search by call, conversation or provider')).toBeVisible()
  })
})
