import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createQaDeal, deleteQaDealIfExists, uniqueSuffix, updateQaDeal } from './helpers/explainApi'
import { attachScreenshot } from './helpers/whyUi'

/**
 * TC-INS-030: "Why?" drawer on the deal detail page
 * Covers:
 *   - UI /backend/customers/deals/:id → record "Why?" (backend:record:current) → overview → status chain
 *   - UI deal status badges "Why this status?" (detail:customers.deal:status-badges) → status chain
 *   - GET /api/insights/explain/descriptors, GET /api/insights/explain (overview + field)
 *
 * The deal status is changed twice through the API as the signed-in admin, so the drawer
 * shows both changes as the viewer's own ("by You") with a proven confidence, and Escape
 * closes the drawer.
 */
test.describe('TC-INS-030: deal detail "Why?" drawer', () => {
  test('opens the drawer from the record and from the status badges and shows the chain', async ({ page, request }, testInfo) => {
    let token: string | null = null
    let dealId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const suffix = uniqueSuffix()
      const title = `QA INS-030 ${suffix}`
      dealId = await createQaDeal(request, token, { title, status: 'open' })
      await updateQaDeal(request, token, dealId, { status: 'qa_in_progress' })
      await updateQaDeal(request, token, dealId, { status: 'qa_negotiation' })

      await login(page, 'admin')
      await page.goto(`/backend/customers/deals/${dealId}`)
      await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 })

      await page.getByRole('button', { name: 'Why?', exact: true }).click()
      const drawer = page.getByRole('dialog', { name: 'Why?' })
      await expect(drawer).toBeVisible()
      await drawer.getByRole('button', { name: /^Explain Status/ }).click()
      await expect(drawer.getByRole('heading', { name: 'Status', exact: true })).toBeVisible()
      await expect(drawer.getByText('Recorded changes', { exact: true })).toBeVisible()
      await expect(drawer.getByText('by You').first()).toBeVisible()
      await expect(drawer.getByText('Proven').first()).toBeVisible()
      await expect(drawer.getByText('qa_negotiation').first()).toBeVisible()
      await attachScreenshot(page, testInfo, 'ins-030-record-drawer')

      await drawer.getByRole('button', { name: 'Change details' }).first().click()
      await expect(drawer.getByText('customers.deals.update').first()).toBeVisible()

      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)

      await page.getByRole('button', { name: 'Why this status?' }).click()
      const statusDrawer = page.getByRole('dialog', { name: 'Why?' })
      await expect(statusDrawer.getByRole('heading', { name: 'Status', exact: true })).toBeVisible()
      await expect(statusDrawer.getByText('qa_in_progress').first()).toBeVisible()
      await expect(statusDrawer.getByRole('link', { name: 'Open as page' })).toHaveAttribute(
        'href',
        `/backend/insights/why?resourceKind=customers.deal&resourceId=${dealId}&field=status`,
      )
      await attachScreenshot(page, testInfo, 'ins-030-status-drawer')
    } finally {
      await deleteQaDealIfExists(request, token, dealId)
    }
  })
})
