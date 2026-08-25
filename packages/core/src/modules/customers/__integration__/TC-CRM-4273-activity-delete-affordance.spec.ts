import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-4273: Delete affordance on the production activity card (PR #4273 QA follow-up).
 *
 * The first pass of #4273 wired deletion into `ActivitiesSection` -> `ActivityTimeline`,
 * but the company detail route renders `ActivityLogTab` -> `ActivityHistorySection` ->
 * `ActivityCard`. UI QA therefore found no delete control on the real timeline. This
 * test drives the production call site so the integration gap cannot reappear:
 *
 *   1. The activity card exposes `Delete activity` inside its overflow actions menu,
 *      and never as a permanently visible control (UX review on #4273).
 *   2. Dismissing the confirmation leaves the row untouched (no DELETE fired).
 *   3. Confirming removes the row, and the interaction is gone from the API.
 *   4. The edit prefill shows the saved `scheduledAt`, not the older `occurredAt`.
 *   5. The Activity log has no horizontal document overflow at a phone viewport.
 */
test.describe('TC-CRM-4273: activity delete + prefill on the production activity card (#4273)', () => {
  test('delete affordance reaches the real timeline and removes the interaction', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    let interactionId: string | null = null
    const stamp = Date.now()
    const meetingTitle = `QA TC-CRM-4273 meeting ${stamp}`

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-4273 Co ${stamp}`)

      // A completed activity whose scheduledAt (14:30) differs from its occurredAt (09:00)
      // on the same recent day, so the prefill assertion is unambiguous.
      const anchor = new Date()
      anchor.setDate(anchor.getDate() - 3)
      anchor.setHours(14, 30, 0, 0)
      const occurred = new Date(anchor)
      occurred.setHours(9, 0, 0, 0)

      const createRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          interactionType: 'meeting',
          title: meetingTitle,
          body: 'QA meeting used to verify the delete affordance',
          status: 'done',
          scheduledAt: anchor.toISOString(),
          occurredAt: occurred.toISOString(),
        },
      })
      expect(
        createRes.ok(),
        `POST /api/customers/interactions returned ${createRes.status()}`,
      ).toBeTruthy()
      const created = (await createRes.json().catch(() => null)) as { id?: string } | null
      interactionId = created?.id ?? null
      expect(interactionId, 'create response should expose interaction id').toBeTruthy()

      await login(page, 'admin')
      await page.goto(`/backend/customers/companies-v2/${companyId}`, {
        waitUntil: 'domcontentloaded',
      })

      const activityTab = page.getByRole('tab', { name: /Activity log/i })
      await expect(activityTab).toBeVisible({ timeout: 30_000 })
      await activityTab.click()

      const activityRow = page.getByText(meetingTitle).first()
      await expect(activityRow).toBeVisible({ timeout: 30_000 })

      // 1. The production ActivityCard MUST expose delete, but only inside the row's
      //    overflow menu — destructive actions stay quiet by default (#4273 UX review).
      //    The fixture company owns a single interaction, so the page-scoped control
      //    is unambiguous.
      // exact: the clickable card wrapper is itself role=button and its subtree
      // accessible name CONTAINS 'Open actions', so substring matching resolves
      // to the card and every interaction lands on row-edit instead of the menu.
      const overflowTrigger = page.getByRole('button', { name: 'Open actions', exact: true }).first()
      await expect(
        overflowTrigger,
        'ActivityCard on the company detail route MUST render an overflow actions menu',
      ).toBeVisible({ timeout: 15_000 })
      await expect(
        page.getByRole('button', { name: /Delete activity/i }),
        'delete MUST NOT be a permanently visible control on the card',
      ).toHaveCount(0)

      // The email card grows when its async action row hydrates, which can move
      // the trigger between Playwright's coordinate resolve and the physical
      // click — a mis-hit lands on the card body and opens the edit dialog
      // instead. Settle the page first, then retry with an Escape reset if the
      // click still lands wrong.
      await page.waitForLoadState('networkidle')
      const openDeleteFromMenu = async () => {
        const deleteItem = page.getByRole('menuitem', { name: /Delete activity/i })
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await overflowTrigger.click()
          const opened = await deleteItem.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true).catch(() => false)
          if (opened) break
          await page.keyboard.press('Escape')
        }
        await expect(deleteItem).toBeVisible({ timeout: 15_000 })
        await deleteItem.click()
      }

      // 2. Dismissing the destructive confirmation must leave the activity alone.
      await openDeleteFromMenu()
      const confirmDialog = page.getByRole('alertdialog')
      await expect(confirmDialog).toBeVisible({ timeout: 15_000 })
      await confirmDialog.getByRole('button', { name: /^Cancel$/i }).click()
      await expect(confirmDialog).toBeHidden({ timeout: 15_000 })
      await expect(page.getByText(meetingTitle).first()).toBeVisible()

      // 3. The edit prefill uses scheduledAt (14:30), not the older occurredAt (09:00).
      await page.getByText(meetingTitle).first().click()
      const editDialog = page.getByRole('dialog')
      const timeTrigger = editDialog.locator('button[aria-haspopup="dialog"]').nth(1)
      await expect(timeTrigger).toBeVisible({ timeout: 15_000 })
      await expect(
        timeTrigger,
        'Edit prefill MUST seed from scheduledAt, which is what the save path writes',
      ).toContainText('02:30 PM')
      await page.keyboard.press('Escape')
      await expect(editDialog).toBeHidden({ timeout: 15_000 })

      // 4. Confirming the delete removes the row and the interaction itself.
      await openDeleteFromMenu()
      const confirmAgain = page.getByRole('alertdialog')
      await expect(confirmAgain).toBeVisible({ timeout: 15_000 })
      await confirmAgain.getByRole('button', { name: /Delete activity/i }).click()

      await expect(page.getByText(meetingTitle)).toHaveCount(0, { timeout: 30_000 })

      const afterRes = await apiRequest(
        request,
        'GET',
        `/api/customers/interactions?entityId=${encodeURIComponent(companyId)}&limit=50`,
        { token },
      )
      expect(afterRes.ok(), `GET /api/customers/interactions returned ${afterRes.status()}`).toBeTruthy()
      const afterBody = (await afterRes.json().catch(() => null)) as { items?: { id?: string }[] } | null
      const stillPresent = (afterBody?.items ?? []).some((item) => item.id === interactionId)
      expect(stillPresent, 'the deleted interaction MUST NOT come back from the API').toBeFalsy()
      if (!stillPresent) interactionId = null
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('Activity log has no horizontal document overflow on a phone viewport', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    let interactionId: string | null = null
    const stamp = Date.now()

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-4273 Mobile Co ${stamp}`)

      const createRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          interactionType: 'call',
          title: `QA TC-CRM-4273 mobile call ${stamp}`,
          status: 'done',
          occurredAt: new Date().toISOString(),
        },
      })
      expect(createRes.ok(), `POST /api/customers/interactions returned ${createRes.status()}`).toBeTruthy()
      const created = (await createRes.json().catch(() => null)) as { id?: string } | null
      interactionId = created?.id ?? null

      await login(page, 'admin')
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`/backend/customers/companies-v2/${companyId}`, {
        waitUntil: 'domcontentloaded',
      })

      const activityTab = page.getByRole('tab', { name: /Activity log/i })
      await expect(activityTab).toBeVisible({ timeout: 30_000 })
      await activityTab.click()
      await expect(page.getByText(/Activity history/i).first()).toBeVisible({ timeout: 30_000 })

      // The day strip renders five fixed-width tiles; they must scroll inside their own
      // container rather than widening the document past the viewport.
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(
        overflow.scrollWidth,
        `document scrollWidth ${overflow.scrollWidth} exceeds viewport ${overflow.clientWidth}`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
