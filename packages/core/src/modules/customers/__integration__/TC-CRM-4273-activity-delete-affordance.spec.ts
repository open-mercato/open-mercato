import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CRM-4273: deleting an activity from the company Activity log (#4273).
 *
 * Drives the production call site (`ActivityLogTab` -> `ActivityHistorySection` ->
 * `ActivityCard`) so the delete control cannot silently go missing from the page users see:
 *
 *   1. `Delete activity` lives inside the card's overflow menu, never as a visible control.
 *   2. Dismissing the confirmation leaves the activity untouched.
 *   3. Confirming removes the row without a reload and the interaction is gone from the API.
 *
 * With the enterprise `record_locks` module on, the company lock widget scopes its headers
 * to the company; the interaction DELETE must still succeed outright.
 */
test.describe('TC-CRM-4273: delete an activity from the company Activity log', () => {
  test('delete lives in the overflow menu, can be dismissed, and removes the interaction', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    let interactionId: string | null = null
    const stamp = Date.now()
    const meetingTitle = `QA TC-CRM-4273 meeting ${stamp}`

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-4273 Co ${stamp}`)

      const createRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          interactionType: 'meeting',
          title: meetingTitle,
          body: 'QA meeting used to verify the delete affordance',
          status: 'done',
          occurredAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        },
      })
      expect(createRes.ok(), `POST /api/customers/interactions returned ${createRes.status()}`).toBeTruthy()
      const created = await readJsonSafe<{ id?: string }>(createRes)
      interactionId = created?.id ?? null
      expect(interactionId, 'create response should expose interaction id').toBeTruthy()

      await login(page, 'admin')
      await page.goto(`/backend/customers/companies-v2/${companyId}`, { waitUntil: 'domcontentloaded' })

      const activityTab = page.getByRole('tab', { name: /Activity log/i })
      await expect(activityTab).toBeVisible({ timeout: 30_000 })
      await activityTab.click()
      await expect(page.getByText(meetingTitle).first()).toBeVisible({ timeout: 30_000 })

      // exact: the clickable card is itself role=button and its accessible name contains
      // 'Open actions', so a substring match resolves to the card instead of the menu trigger.
      const overflowTrigger = page.getByRole('button', { name: 'Open actions', exact: true }).first()
      await expect(overflowTrigger, 'the activity card must render an overflow actions menu').toBeVisible({ timeout: 15_000 })
      await expect(
        page.getByRole('button', { name: /Delete activity/i }),
        'delete must not be a permanently visible control on the card',
      ).toHaveCount(0)

      const openDeleteFromMenu = async () => {
        const deleteItem = page.getByRole('menuitem', { name: /Delete activity/i })
        await expect(async () => {
          await overflowTrigger.click()
          await expect(deleteItem).toBeVisible({ timeout: 3_000 })
        }).toPass({ timeout: 20_000 })
        await deleteItem.click()
      }

      await openDeleteFromMenu()
      const confirmDialog = page.getByRole('alertdialog')
      await expect(confirmDialog).toBeVisible({ timeout: 15_000 })
      await confirmDialog.getByRole('button', { name: /^Cancel$/i }).click()
      await expect(confirmDialog).toBeHidden({ timeout: 15_000 })
      await expect(page.getByText(meetingTitle).first()).toBeVisible()

      await openDeleteFromMenu()
      await expect(confirmDialog).toBeVisible({ timeout: 15_000 })
      const deleteResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'DELETE' && response.url().includes('/api/customers/interactions'),
        { timeout: 15_000 },
      )
      await confirmDialog.getByRole('button', { name: /Delete activity/i }).click()
      const deleteResponse = await deleteResponsePromise
      expect(
        deleteResponse.status(),
        `DELETE /api/customers/interactions responded ${deleteResponse.status()}`,
      ).toBe(200)

      await expect(page.getByText('Activity deleted').first()).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(meetingTitle)).toHaveCount(0, { timeout: 30_000 })

      const afterRes = await apiRequest(
        request,
        'GET',
        `/api/customers/interactions?entityId=${encodeURIComponent(companyId)}&limit=50`,
        { token },
      )
      expect(afterRes.ok(), `GET /api/customers/interactions returned ${afterRes.status()}`).toBeTruthy()
      const afterBody = await readJsonSafe<{ items?: { id?: string }[] }>(afterRes)
      const stillPresent = (afterBody?.items ?? []).some((item) => item.id === interactionId)
      expect(stillPresent, 'the deleted interaction must not come back from the API').toBeFalsy()
      if (!stillPresent) interactionId = null
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
