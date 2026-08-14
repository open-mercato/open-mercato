import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

test.describe('TC-DOCUMENT-005: document generators backend navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin')
  })

  test('overview links to dedicated template and history pages', async ({ page }) => {
    await page.goto('/backend/document-generators')
    await expect(page).toHaveURL(/\/backend\/document-generators\/overview$/)

    await expect(page.getByTestId('document-generators-overview-page')).toBeVisible()
    await expect(page.getByTestId('document-generators-templates-link')).toHaveAttribute(
      'href',
      '/backend/document-generators/templates',
    )
    await expect(page.getByTestId('document-generators-history-link')).toHaveAttribute(
      'href',
      '/backend/document-generators/history',
    )

    await page.getByTestId('document-generators-templates-link').click()
    await expect(page).toHaveURL(/\/backend\/document-generators\/templates$/)
    await expect(page.getByTestId('document-generators-templates-page')).toBeVisible()

    await page.goto('/backend/document-generators/overview')
    await page.getByTestId('document-generators-history-link').click()
    await expect(page).toHaveURL(/\/backend\/document-generators\/history$/)
    await expect(page.getByTestId('document-generators-history-page')).toBeVisible()
  })
})
