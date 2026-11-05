import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-051: Task type chip is visible in the Activity history filter row (issue #1805).
 *
 * Spec: .ai/specs/2026-05-06-crm-fixes-3.md (Cluster B — Step 1).
 *
 * Before this fix the activity-log timeline silently dropped tasks because:
 *   - `TYPE_FILTERS` in `ActivityHistorySection.tsx` only listed call/email/meeting/note,
 *     so users could not opt in to seeing tasks in the timeline.
 *   - `ACTIVITY_TYPES` in `ActivityTypeSelector.tsx` mirrored the same omission, so the
 *     inline composer also could not produce tasks.
 *   - `ActivityHistorySection` further passed `excludeInteractionType=task` unconditionally
 *     when querying `/api/customers/interactions`, which meant even API-created tasks
 *     never reached the UI.
 *
 * This test guards the visible regression: the Task chip is rendered in the filter row,
 * and selecting it surfaces task interactions whose `status === 'done'`.
 */
test.describe('TC-CRM-051: Task type chip surfaces tasks in the Activity history filter (#1805)', () => {
  test('Task chip is visible and selecting it shows the API-created task', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    let interactionId: string | null = null
    const stamp = Date.now()
    const taskTitle = `QA TC-CRM-051 task ${stamp}`

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-051 Co ${stamp}`)

      const interactionRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          interactionType: 'task',
          title: taskTitle,
          body: 'QA task description',
          status: 'done',
          occurredAt: new Date().toISOString(),
        },
      })
      expect(
        interactionRes.ok(),
        `POST /api/customers/interactions returned ${interactionRes.status()}`,
      ).toBeTruthy()
      const interactionPayload = await interactionRes.json().catch(() => null) as { id?: string } | null
      interactionId = interactionPayload?.id ?? null

      await login(page, 'admin')
      await page.goto(`/backend/customers/companies-v2/${companyId}`, {
        waitUntil: 'domcontentloaded',
      })

      // Open the Activity log tab (label "Activity log" — see CompanyDetailTabs.tsx).
      await page.getByRole('tab', { name: /Activity log/i }).click()

      // The Task chip MUST render alongside Call/Email/Meeting/Note.
      const taskChip = page.getByRole('button', { name: /^Task( \d+)?$/ })
      await expect(taskChip).toBeVisible({ timeout: 15_000 })

      // Selecting the Task filter narrows the API request and surfaces the task.
      await taskChip.click()

      await expect(page.getByText(taskTitle).first()).toBeVisible({ timeout: 15_000 })
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
