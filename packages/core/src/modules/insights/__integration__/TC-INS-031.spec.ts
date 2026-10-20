import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createQaDeal, deleteQaDealIfExists, uniqueSuffix, updateQaDeal } from './helpers/explainApi'
import { attachScreenshot } from './helpers/whyUi'

/**
 * TC-INS-031: "Why?" deep-link page
 * Covers:
 *   - UI /backend/insights/why?resourceKind=&resourceId=&field= (server page + client leaf)
 *   - GET /api/insights/explain (field and overview), GET /api/insights/explain/descriptors
 *
 * The page explains the field named in the query, switching to the overview drops the
 * `field` parameter from the URL, and an unknown record shows the not-found state.
 */
test.describe('TC-INS-031: "Why?" deep-link page', () => {
  test('explains the field from the URL, navigates to the overview, and handles unknown records', async ({ page, request }, testInfo) => {
    let token: string | null = null
    let dealId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      dealId = await createQaDeal(request, token, { title: `QA INS-031 ${uniqueSuffix()}`, status: 'open' })
      await updateQaDeal(request, token, dealId, { status: 'qa_won_review' })

      await login(page, 'admin')
      await page.goto(`/backend/insights/why?resourceKind=customers.deal&resourceId=${dealId}&field=status`)
      await expect(page.getByRole('heading', { name: 'Status', exact: true })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText('Recorded changes', { exact: true })).toBeVisible()
      await expect(page.getByText('qa_won_review').first()).toBeVisible()
      await expect(page.getByText('Explained').first()).toBeVisible()
      await attachScreenshot(page, testInfo, 'ins-031-field')

      await page.getByRole('button', { name: 'All fields' }).click()
      await expect(page).toHaveURL((url) => url.pathname === '/backend/insights/why' && !url.searchParams.has('field'))
      await expect(page.getByRole('button', { name: /^Explain Status/ })).toBeVisible()
      await attachScreenshot(page, testInfo, 'ins-031-overview')

      await page.goto(`/backend/insights/why?resourceKind=customers.deal&resourceId=${randomUUID()}`)
      await expect(page.getByText('Nothing to explain')).toBeVisible({ timeout: 20_000 })

      await page.goto('/backend/insights/why')
      await expect(page.getByText('Choose a record to explain')).toBeVisible({ timeout: 20_000 })
    } finally {
      await deleteQaDealIfExists(request, token, dealId)
    }
  })
})
