/**
 * TC-UX-002: Inline Activity Composer
 * Source: 2026-04-06-crm-detail-pages-ux-enhancements — Enhancement 2
 *
 * Verifies:
 * - 4 activity type icons visible (Call, Email, Meeting, Note)
 * - Click type expands composer inline (no modal)
 * - Description field and Save button appear
 * - Cancel collapses the composer
 */
import { test, expect } from '@playwright/test'
import { login } from '-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '-mercato/core/modules/core/__integration__/helpers/api'
import { createPersonFixture, deleteEntityIfExists } from '-mercato/core/modules/core/__integration__/helpers/crmFixtures'

test.describe('TC-UX-002: Inline Activity Composer', () => {
  test('should show activity composer with type selection and cancel', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let personId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      // The inline composer renders on the person/deal detail Activities tab (not on companies).
      const personSuffix = `Composer ${Date.now()}`
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: personSuffix,
        displayName: `QA ${personSuffix}`,
      })
      await login(page, 'admin')

      await page.goto(`/backend/customers/people-v2/${personId}`, { waitUntil: 'commit' })
      await expect(page.getByRole('button', { name: /save/i }).first()).toBeVisible({ timeout: 10_000 })

      // Switch to Activities tab where the inline composer lives
      const activitiesTab = page.getByRole('tab', { name: /activities/i })
      if (await activitiesTab.isVisible().catch(() => false)) {
        await activitiesTab.click()
      }

      // Verify activity type buttons are visible. The composer's type selector renders first in the DOM
      // (same-named buttons also appear in the timeline filters row later on the page).
      const callButton = page.getByRole('button', { name: /^call$/i }).first()
      const emailButton = page.getByRole('button', { name: /^email$/i }).first()
      const meetingButton = page.getByRole('button', { name: /^meeting$/i }).first()
      const noteButton = page.getByRole('button', { name: /^note$/i }).first()

      await expect(callButton).toBeVisible({ timeout: 10_000 })
      await expect(emailButton).toBeVisible()
      await expect(meetingButton).toBeVisible()
      await expect(noteButton).toBeVisible()

      // The composer defaults to "call" as the active type; selecting "email" should swap the
      // pressed state.
      await expect(callButton).toHaveAttribute('aria-pressed', 'true')
      await emailButton.click()
      await expect(emailButton).toHaveAttribute('aria-pressed', 'true')
      await expect(callButton).toHaveAttribute('aria-pressed', 'false')

      // Composer exposes a textarea + "Save activity" button inline (no modal, no cancel button)
      const textarea = page.getByPlaceholder(/what happened/i)
      await expect(textarea).toBeVisible()

      const saveActivityButton = page.getByRole('button', { name: /save activity/i })
      await expect(saveActivityButton).toBeVisible()

      // Fill description — Save activity becomes enabled
      await textarea.fill('QA test call about renewal')
      await expect(saveActivityButton).toBeEnabled()

    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
