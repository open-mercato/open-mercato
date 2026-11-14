import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

export const integrationMeta = { dependsOnModules: ['customers'] }

test('failed and cancelled operation summaries stay distinct from success on narrow screens', async ({ page }, testInfo) => {
  let status: 'failed' | 'cancelled' = 'failed'
  await page.route('**/api/progress/active', (route) => route.fulfill({
    json: {
      active: [],
      recentlyCompleted: [{
        id: 'responsive-terminal-progress-job',
        jobType: 'customers.bulk_reassign',
        name: 'An unsuccessful operation with a long descriptive title',
        status,
        progressPercent: 20,
        processedCount: 2,
        totalCount: 10,
        cancellable: false,
        errorMessage: status === 'failed' ? 'The operation was refused' : null,
      }],
    },
  }))
  await login(page, 'admin')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/backend/customers/deals')
  const failedSummary = page.getByRole('button', { name: '1 operations failed', exact: true })
  await expect(failedSummary).toBeVisible()
  await failedSummary.click()
  await expect(page.getByText('The operation was refused', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '1 operations completed', exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await testInfo.attach('mobile-failed-operation-summary', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })
  status = 'cancelled'
  await page.reload()
  await expect(page.getByRole('button', { name: '1 operations cancelled', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '1 operations completed', exact: true })).toHaveCount(0)
})

