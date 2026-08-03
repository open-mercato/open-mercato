import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

test.describe('TC-QIDX-4593: failed reindex status', () => {
  test('renders a failed reindex with the semantic error badge', async ({ page }) => {
    await login(page, 'superadmin')
    await page.route('**/api/query_index/status*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              entityId: 'customers:customer_activity',
              label: 'Customer activity',
              baseCount: 11,
              indexCount: 10,
              vectorCount: null,
              vectorEnabled: false,
              fulltextCount: null,
              fulltextEnabled: false,
              ok: false,
              job: {
                status: 'failed',
                processedCount: 10,
                totalCount: 11,
                finishedAt: '2026-07-28T10:05:00.000Z',
                partitions: [],
                scope: {
                  status: 'failed',
                  processedCount: 10,
                  totalCount: 11,
                },
              },
            },
          ],
          errors: [],
          logs: [],
        }),
      })
    })

    await page.goto('/backend/query-indexes', { waitUntil: 'domcontentloaded' })

    await expect(page.getByText('customers:customer_activity', { exact: true })).toBeVisible()
    const failedBadge = page.locator('.bg-status-error-bg').filter({ hasText: 'Failed' })
    await expect(failedBadge).toBeVisible()
  })
})
