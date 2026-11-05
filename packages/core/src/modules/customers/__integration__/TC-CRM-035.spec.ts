import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

test.describe('TC-CRM-035: Company changelog tab filters, export, and pagination', () => {
  test('should show filtered company changes and export them as CSV', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA Changelog ${Date.now()}`)

      for (let index = 0; index < 52; index += 1) {
        const response = await apiRequest(request, 'PUT', '/api/customers/companies', {
          token,
          data: {
            id: companyId,
            displayName: `QA Changelog ${Date.now()} ${index}`,
          },
        })
        expect(response.ok(), `update ${index} should succeed`).toBeTruthy()
      }

      await login(page, 'admin')
      await page.goto(`/backend/customers/companies-v2/${companyId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('button', { name: /save/i }).first()).toBeVisible({ timeout: 10_000 })

      await page.getByRole('tab', { name: /change log/i }).click()

      await expect(page.getByText(/change log/i).first()).toBeVisible()
      await expect(page.getByText(/all changes/i).first()).toBeVisible()
      await expect(page.getByRole('button', { name: /^Older$/i })).toBeVisible()

      const userSortResponsePromise = page.waitForResponse((response) =>
        response.url().includes('/api/audit_logs/audit-logs/actions?') &&
        response.url().includes(`resourceId=${companyId}`) &&
        response.url().includes('limit=50') &&
        response.url().includes('sortField=user') &&
        response.url().includes('sortDir=asc') &&
        response.request().method() === 'GET',
      )
      await page.getByRole('button', { name: /^User$/i }).click()
      const userSortResponse = await userSortResponsePromise
      expect(userSortResponse.ok()).toBeTruthy()

      await page.getByRole('button', { name: 'All fields' }).click()
      await page.getByRole('button', { name: /^Entity display Name$/i }).click()
      await expect(page.getByRole('button', { name: /^Entity display Name$/i }).first()).toBeVisible()
      await page.keyboard.press('Escape')

      const exportResponsePromise = page.waitForResponse((response) =>
        response.url().includes('/api/audit_logs/audit-logs/actions/export') &&
        response.request().method() === 'GET',
      )
      await page.getByRole('button', { name: /Export CSV/i }).click()
      const exportResponse = await exportResponsePromise
      expect(exportResponse.ok()).toBeTruthy()
      const csv = await exportResponse.text()
      expect(csv).toContain('When,User,Action,Field,Old Value,New Value,Source')
      expect(csv).toContain('displayName')

      await page.getByRole('button', { name: /^Next$/i }).click()
      await expect(page.getByRole('button', { name: /^Previous$/i })).toBeVisible()
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
