import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-053: Activity validation — date+time required indicators in the dialog;
 * phone is rejected when malformed and persists across edit on Call activities.
 *
 * Spec: .ai/specs/2026-05-06-crm-fixes-3.md (Cluster C — Step 3).
 *
 * Before this fix:
 *   - `interactionCreateSchema` did not validate `date`/`time` so the Schedule
 *     Activity dialog could persist payloads with empty timestamps that
 *     surfaced as "invisible records" in the timeline (#1806).
 *   - `phoneNumber` accepted any string on Call activities (#1808 part 1) and
 *     the `ScheduleActivityDialog` form-load `useEffect` did not seed
 *     `callPhoneNumber` from `customValues.callPhoneNumber`, so the persisted
 *     phone disappeared the next time the activity was opened for edit
 *     (#1808 part 2).
 *
 * Each contract gets its own Playwright test so a failure in one does not
 * starve the rest of the wave with a single 60s timeout.
 */
test.describe('TC-CRM-053: Activity validation — date/time required, phone validated (#1806, #1808)', () => {
  test('API rejects empty date on POST /api/customers/interactions (#1806)', async ({ request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    const stamp = Date.now()

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-053a Co ${stamp}`)

      const res = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          interactionType: 'note',
          title: 'Empty date',
          date: '',
          time: '10:00',
        },
      })
      expect(
        res.status(),
        `Empty date should return 400, got ${res.status()}`,
      ).toBe(400)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('API rejects empty time on POST /api/customers/interactions (#1806)', async ({ request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    const stamp = Date.now()

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-053b Co ${stamp}`)

      const res = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          interactionType: 'note',
          title: 'Empty time',
          date: '2026-05-15',
          time: '',
        },
      })
      expect(
        res.status(),
        `Empty time should return 400, got ${res.status()}`,
      ).toBe(400)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('API rejects malformed phoneNumber on Call activity (#1808)', async ({ request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    const stamp = Date.now()

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-053c Co ${stamp}`)

      const res = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          interactionType: 'call',
          title: 'Bad phone',
          scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          phoneNumber: 'not-a-phone',
        },
      })
      expect(
        res.status(),
        `Malformed call phoneNumber should return 400, got ${res.status()}`,
      ).toBe(400)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('Phone number persists on a Call activity GET response so the edit dialog can re-hydrate (#1808)', async ({ request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    let interactionId: string | null = null
    const stamp = Date.now()
    const callTitle = `QA TC-CRM-053d call ${stamp}`

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-053d Co ${stamp}`)

      const createRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          interactionType: 'call',
          title: callTitle,
          status: 'planned',
          scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          phoneNumber: '+15555550100',
          // The production dialog writes the phone into customValues; we mirror
          // that storage shape here so the GET-response assertion below is
          // representative of the real round-trip path.
          customValues: { callPhoneNumber: '+15555550100', callDirection: 'outbound' },
        },
      })
      expect(
        createRes.ok(),
        `POST /api/customers/interactions returned ${createRes.status()}`,
      ).toBeTruthy()
      const created = await createRes.json().catch(() => null) as { id?: string } | null
      interactionId = created?.id ?? null
      expect(interactionId, 'create response should expose interaction id').toBeTruthy()

      const listRes = await apiRequest(
        request,
        'GET',
        `/api/customers/interactions?entityId=${companyId}&interactionType=call`,
        { token },
      )
      expect(listRes.ok(), `GET interactions returned ${listRes.status()}`).toBeTruthy()
      const listBody = await listRes.json().catch(() => null) as
        | { items?: Array<{ id?: string; customValues?: Record<string, unknown> | null }> }
        | null
      const found = (listBody?.items ?? []).find((item) => item?.id === interactionId)
      expect(
        found,
        'created Call interaction should appear in the list response so the edit dialog can re-hydrate',
      ).toBeTruthy()
      expect(
        found?.customValues?.callPhoneNumber,
        'GET response MUST expose callPhoneNumber on customValues so the dialog form-load useEffect can seed phoneNumber on edit (#1808 part 2)',
      ).toBe('+15555550100')
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('Schedule Activity dialog renders required-field indicators on Date and Start Time (#1806)', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    const stamp = Date.now()

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-053e Co ${stamp}`)

      await login(page, 'admin')
      await page.goto(`/backend/customers/companies-v2/${companyId}`, {
        waitUntil: 'domcontentloaded',
      })

      // Switch to Activity log tab — the Activities card with "Add new" lives
      // under it. We wait for the tab to render before clicking (the page
      // tablist can take a few seconds to hydrate after navigation).
      const activityTab = page.getByRole('tab', { name: /Activity log/i })
      await expect(activityTab).toBeVisible({ timeout: 30_000 })
      await activityTab.click()

      // Wait for the Activities card to mount under the tabpanel. The "Add new"
      // CTA is the trigger for `ActivitiesAddNewMenu`.
      const addNewTrigger = page.getByRole('button', { name: /^Add new$/ })
      await expect(addNewTrigger).toBeVisible({ timeout: 30_000 })
      await addNewTrigger.click()

      // The popover lists Log call / New meeting / etc. Pick "Log call" so the
      // dialog opens on the Call tab where both Date and Start Time render.
      const logCallItem = page.getByRole('button', { name: /Log call/i }).first()
      await expect(logCallItem).toBeVisible({ timeout: 15_000 })
      await logCallItem.click()

      // The DateTimeFields component renders required asterisks via a
      // DS-token span (`text-status-error-foreground`). On the Call tab both
      // Date and Start Time inputs render (so two markers appear).
      const requiredMarkers = page.locator('span[aria-hidden="true"].text-status-error-foreground')
      await expect(requiredMarkers.first()).toBeVisible({ timeout: 15_000 })
      await expect(requiredMarkers).toHaveCount(2)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('Schedule Activity dialog shows inline phone validation instead of a generic save failure (#1808)', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    const stamp = Date.now()
    const phoneError = 'Enter a valid phone number with country code (e.g. +1 212 555 1234)'

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-053f Co ${stamp}`)

      await login(page, 'admin')
      await page.goto(`/backend/customers/companies-v2/${companyId}`, {
        waitUntil: 'domcontentloaded',
      })

      const activityTab = page.getByRole('tab', { name: /Activity log/i })
      await expect(activityTab).toBeVisible({ timeout: 30_000 })
      await activityTab.click()

      const addNewTrigger = page.getByRole('button', { name: /^Add new$/ })
      await expect(addNewTrigger).toBeVisible({ timeout: 30_000 })
      await addNewTrigger.click()

      const logCallItem = page.getByRole('button', { name: /Log call/i }).first()
      await expect(logCallItem).toBeVisible({ timeout: 15_000 })
      await logCallItem.click()

      await page.getByPlaceholder('Activity title...').fill(`QA TC-CRM-053f call ${stamp}`)
      await page.getByLabel('Phone number').fill('not-a-phone')
      await page.getByRole('button', { name: /^Log call$/ }).click()

      await expect(page.getByText(phoneError).first()).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText('Failed to schedule activity')).toHaveCount(0)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
