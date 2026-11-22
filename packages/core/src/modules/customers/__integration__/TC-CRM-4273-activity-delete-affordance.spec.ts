import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

// A meeting later today, so it sits in the planned list and the week preview the page opens on.
// Ten minutes ahead keeps it open, not overdue; right before midnight it moves closer
// instead of slipping into tomorrow.
function laterToday(): string {
  const now = new Date()
  const candidate = new Date(now.getTime() + 10 * 60 * 1000)
  const scheduled = candidate.getDate() === now.getDate() ? candidate : new Date(now.getTime() + 60 * 1000)
  return scheduled.toISOString()
}

async function openActivityLog(page: Page, companyId: string): Promise<void> {
  await page.goto(`/backend/customers/companies-v2/${companyId}?tab=activity-log`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /^Interaction history/ })).toBeVisible({ timeout: 30_000 })
}

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
 * The second test covers what the rest of the screen shows about the same record: the
 * planned list, the week preview and the filter count follow the delete and its Undo.
 * The third signs in as the seeded employee, who can read interactions but not manage
 * them, and checks that Delete is not offered at all.
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

  test('the planned list, week preview and meeting count follow a delete and its Undo', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    let interactionId: string | null = null
    const stamp = Date.now()
    const meetingTitle = `QA TC-CRM-4273 planned ${stamp}`

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-4273 Planned Co ${stamp}`)

      const createRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          interactionType: 'meeting',
          title: meetingTitle,
          status: 'planned',
          scheduledAt: laterToday(),
        },
      })
      expect(createRes.ok(), `POST /api/customers/interactions returned ${createRes.status()}`).toBeTruthy()
      interactionId = (await readJsonSafe<{ id?: string }>(createRes))?.id ?? null
      expect(interactionId, 'create response should expose interaction id').toBeTruthy()

      await login(page, 'admin')
      await openActivityLog(page, companyId)

      const escapedTitle = meetingTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const plannedRow = page.getByRole('button', { name: new RegExp(`^${escapedTitle} .* More$`) })
      const plannedCount = page.getByText(/Planned activities\s*1/)
      const everyMention = page.getByText(meetingTitle)
      const meetingCount = page.getByRole('button', { name: 'Meeting 1', exact: true })
      const historyRow = page
        .getByRole('button')
        .filter({ hasText: meetingTitle })
        .filter({ has: page.getByRole('button', { name: 'Open actions', exact: true }) })
        .last()

      await expect(plannedRow, 'the planned list shows the meeting').toBeVisible({ timeout: 30_000 })
      await expect(plannedCount, 'the planned list counts it').toBeVisible()
      await expect(meetingCount, 'the meeting filter counts it').toBeVisible()
      await expect(historyRow).toBeVisible()
      // The week preview, the planned list and the history each name the meeting.
      await expect
        .poll(async () => everyMention.count(), { message: 'week preview, planned list and history all show the meeting' })
        .toBeGreaterThanOrEqual(3)
      const mentionsBefore = await everyMention.count()

      const deleteItem = page.getByRole('menuitem', { name: /Delete activity/i })
      await expect(async () => {
        await historyRow.getByRole('button', { name: 'Open actions', exact: true }).click()
        await expect(deleteItem).toBeVisible({ timeout: 3_000 })
      }).toPass({ timeout: 20_000 })
      await deleteItem.click()
      const confirmDialog = page.getByRole('alertdialog')
      await expect(confirmDialog).toBeVisible({ timeout: 15_000 })
      await confirmDialog.getByRole('button', { name: /Delete activity/i }).click()
      await expect(page.getByText('Activity deleted').first()).toBeVisible({ timeout: 15_000 })

      await expect(everyMention, 'the meeting is gone from every part of the screen').toHaveCount(0, { timeout: 30_000 })
      await expect(plannedCount, 'the planned list no longer counts it').toHaveCount(0)
      await expect(meetingCount, 'the meeting filter no longer counts it').toHaveCount(0)

      await page.getByRole('button', { name: /^Undo(?: last action)?$/ }).first().click()

      await expect(plannedRow, 'Undo brings the meeting back to the planned list').toBeVisible({ timeout: 30_000 })
      await expect(plannedCount).toBeVisible()
      await expect(meetingCount).toBeVisible()
      await expect(historyRow).toBeVisible()
      await expect(everyMention, 'Undo restores every mention, the week preview included').toHaveCount(mentionsBefore, { timeout: 30_000 })
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('a user who cannot manage interactions is not offered Delete', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    let interactionId: string | null = null
    const stamp = Date.now()
    const meetingTitle = `QA TC-CRM-4273 read-only ${stamp}`

    try {
      token = await getAuthToken(request, 'admin')
      const employeeToken = await getAuthToken(request, 'employee')
      const featureCheck = await apiRequest(request, 'POST', '/api/auth/feature-check', {
        token: employeeToken,
        data: { features: ['customers.interactions.view', 'customers.interactions.manage'] },
      })
      const granted = (await readJsonSafe<{ granted?: string[] }>(featureCheck))?.granted ?? []
      expect(granted, 'the employee can read interactions').toContain('customers.interactions.view')
      expect(granted, 'the employee cannot manage interactions').not.toContain('customers.interactions.manage')

      companyId = await createCompanyFixture(request, token, `QA TC-CRM-4273 Read Co ${stamp}`)
      const createRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          interactionType: 'meeting',
          title: meetingTitle,
          status: 'done',
          occurredAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        },
      })
      expect(createRes.ok(), `POST /api/customers/interactions returned ${createRes.status()}`).toBeTruthy()
      interactionId = (await readJsonSafe<{ id?: string }>(createRes))?.id ?? null

      await login(page, 'employee')
      // The check that reveals Delete answers after the list renders; wait for its
      // answer before asserting that nothing appeared.
      const deleteAccessAnswered = page.waitForResponse(
        (response) =>
          response.url().includes('/api/auth/feature-check') &&
          (response.request().postData() ?? '').includes('customers.activities.manage'),
        { timeout: 45_000 },
      )
      await openActivityLog(page, companyId)
      await expect(page.getByText(meetingTitle).first()).toBeVisible({ timeout: 30_000 })
      await deleteAccessAnswered
      const overflowTriggers = page.getByRole('button', { name: 'Open actions', exact: true })
      for (const trigger of await overflowTriggers.all()) {
        await trigger.click()
        await expect(page.getByRole('menuitem', { name: /Delete activity/i })).toHaveCount(0)
        await page.keyboard.press('Escape')
      }
      await expect(page.getByRole('button', { name: /Delete activity/i })).toHaveCount(0)
      await expect(page.getByRole('alertdialog')).toHaveCount(0)

      const stillThere = await apiRequest(
        request,
        'GET',
        `/api/customers/interactions?entityId=${encodeURIComponent(companyId)}&limit=50`,
        { token },
      )
      const items = (await readJsonSafe<{ items?: { id?: string }[] }>(stillThere))?.items ?? []
      expect(items.some((item) => item.id === interactionId), 'the meeting is untouched').toBeTruthy()
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
