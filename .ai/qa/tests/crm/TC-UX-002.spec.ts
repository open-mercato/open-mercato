/**
 * TC-UX-002: Inline Activity Composer
 * Source: SPEC-048 — Enhancement 2
 *
 * Verifies:
 * - 4 activity type icons visible (Call, Email, Meeting, Note)
 * - Click type expands composer inline (no modal)
 * - Description field and Save button appear
 * - Cancel collapses the composer
 */
import { test, expect } from '@playwright/test'
import { login } from '../helpers/auth'
import { getAuthToken } from '../helpers/api'
import { createCompanyFixture, deleteEntityIfExists } from '../helpers/crmFixtures'

test.describe('TC-UX-002: Inline Activity Composer', () => {
  test('should show activity composer with type selection and cancel', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA Composer Test ${Date.now()}`)
      await login(page, 'admin')

      await page.goto(`/backend/customers/companies-v2/${companyId}`, { waitUntil: 'commit' })
      await expect(page.getByRole('button', { name: /save/i }).first()).toBeVisible({ timeout: 10_000 })

      // Verify activity type buttons are visible
      const callButton = page.getByRole('button', { name: /^call$/i })
      const emailButton = page.getByRole('button', { name: /^email$/i })
      const meetingButton = page.getByRole('button', { name: /^meeting$/i })
      const noteButton = page.getByRole('button', { name: /^note$/i })

      await expect(callButton).toBeVisible()
      await expect(emailButton).toBeVisible()
      await expect(meetingButton).toBeVisible()
      await expect(noteButton).toBeVisible()

      // Click call type — composer should expand
      await callButton.click()

      // Verify composer expanded — textarea and save button appear
      const textarea = page.getByPlaceholder(/what happened/i)
      await expect(textarea).toBeVisible()

      const saveActivityButton = page.getByRole('button', { name: /save activity/i })
      await expect(saveActivityButton).toBeVisible()

      // Fill description
      await textarea.fill('QA test call about renewal')

      // Cancel the composer
      const cancelButton = page.getByRole('button', { name: /^cancel$/i }).last()
      await cancelButton.click()

      // Verify composer collapsed — textarea should disappear
      await expect(textarea).not.toBeVisible({ timeout: 3_000 })

      // Type buttons should still be visible
      await expect(callButton).toBeVisible()

    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
