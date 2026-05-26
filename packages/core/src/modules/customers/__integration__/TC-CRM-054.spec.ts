import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-054: Editing a historical activity prefills correctly and saves.
 *
 * Spec: .ai/specs/2026-05-06-crm-fixes-3.md (Cluster D — Step 4).
 * Issue: https://github.com/open-mercato/open-mercato/issues/1807
 *
 * Before this fix:
 *   - The Schedule Activity dialog seeded `date`/`startTime` from
 *     `editData.scheduledAt` only. Past activities (status=`done`) carry the
 *     historical timestamp on `occurredAt`, so the prefill silently fell back
 *     to `new Date()` — every edit opened on "today" instead of the original
 *     moment.
 *   - The dialog PUTs to `/api/customers/interactions`, which is canonical
 *     only. Activities that still live exclusively in the legacy
 *     `customer_activities` table (no canonical mirror) returned
 *     `{ error: "Interaction not found" }` (404) on save.
 *
 * Fix:
 *   - `useScheduleFormState` now derives the seed date/time from
 *     `occurredAt ?? scheduledAt` and formats them in the user's local
 *     timezone via `date-fns` `format(...)`.
 *   - `/api/customers/interactions` PUT runs a legacy-bridge step in its
 *     `mapInput` so historical activities are auto-mirrored into
 *     `customer_interactions` before the canonical update command runs.
 *
 * Each contract gets its own Playwright test so a failure in one does not
 * starve the rest of the wave with a single timeout.
 */
test.describe('TC-CRM-054: Edit historical activity (#1807)', () => {
  test('PUT /api/customers/interactions returns 200 (not 404) when editing an existing past Meeting', async ({ request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    let interactionId: string | null = null
    const stamp = Date.now()
    const initialTitle = `QA TC-CRM-054a meeting ${stamp}`
    const updatedTitle = `${initialTitle} (edited)`
    // Pick a deliberately past timestamp — the bug only manifests when
    // `occurredAt` (historical) carries the moment instead of `scheduledAt`.
    const occurredAt = new Date('2025-12-01T14:30:00.000Z').toISOString()

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-054a Co ${stamp}`)

      const createRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          interactionType: 'meeting',
          title: initialTitle,
          status: 'done',
          date: '2025-12-01',
          time: '14:30',
          occurredAt,
        },
      })
      expect(
        createRes.ok(),
        `POST /api/customers/interactions returned ${createRes.status()}`,
      ).toBeTruthy()
      const created = await createRes.json().catch(() => null) as { id?: string } | null
      interactionId = created?.id ?? null
      expect(interactionId, 'create response should expose interaction id').toBeTruthy()

      // Editing an existing canonical interaction MUST NOT return 404 (#1807
      // regression baseline). The dialog payload re-includes most fields it
      // forwarded on create plus the new title.
      const putRes = await apiRequest(request, 'PUT', '/api/customers/interactions', {
        token,
        data: {
          id: interactionId,
          entityId: companyId,
          interactionType: 'meeting',
          title: updatedTitle,
          status: 'done',
          date: '2025-12-01',
          time: '14:30',
          occurredAt,
        },
      })
      expect(
        putRes.status(),
        `PUT /api/customers/interactions on existing record should return 200, got ${putRes.status()}`,
      ).toBe(200)

      // Confirm the title actually flipped through to the read model.
      const listRes = await apiRequest(
        request,
        'GET',
        `/api/customers/interactions?entityId=${companyId}&interactionType=meeting`,
        { token },
      )
      expect(listRes.ok(), `GET interactions returned ${listRes.status()}`).toBeTruthy()
      const listBody = await listRes.json().catch(() => null) as
        | { items?: Array<{ id?: string; title?: string | null; occurredAt?: string | null }> }
        | null
      const found = (listBody?.items ?? []).find((item) => item?.id === interactionId)
      expect(found?.title, 'updated title should round-trip').toBe(updatedTitle)
      expect(
        typeof found?.occurredAt === 'string' && found.occurredAt.length > 0,
        'GET response MUST expose occurredAt so the dialog form-load useEffect can seed date/time on edit (#1807 prefill)',
      ).toBeTruthy()
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('PUT /api/customers/interactions auto-bridges legacy activities (no more "Interaction not found" 404)', async ({ request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    let activityId: string | null = null
    const stamp = Date.now()
    const initialSubject = `QA TC-CRM-054b legacy ${stamp}`
    const updatedTitle = `${initialSubject} (edited)`

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-054b Co ${stamp}`)

      // Create a legacy activity through the deprecated /activities adapter.
      // This is the wire shape that produces the 404 in #1807 reproductions:
      // activities created through the legacy adapter live in
      // `customer_activities` and (when not yet bridged) only there.
      const createRes = await apiRequest(request, 'POST', '/api/customers/activities', {
        token,
        data: {
          entityId: companyId,
          activityType: 'meeting',
          subject: initialSubject,
          occurredAt: new Date('2025-11-15T10:00:00.000Z').toISOString(),
        },
      })
      expect(
        createRes.ok(),
        `POST /api/customers/activities returned ${createRes.status()}`,
      ).toBeTruthy()
      const created = await createRes.json().catch(() => null) as { id?: string } | null
      activityId = created?.id ?? null
      expect(activityId, 'legacy activity create response should expose id').toBeTruthy()

      // Hit the canonical PUT endpoint (the path the new ScheduleActivityDialog
      // uses). Without the bridge fix this returned `{ error: "Interaction
      // not found" }` (404). With the fix the legacy row is auto-mirrored into
      // `customer_interactions` so the canonical update succeeds.
      const putRes = await apiRequest(request, 'PUT', '/api/customers/interactions', {
        token,
        data: {
          id: activityId,
          entityId: companyId,
          interactionType: 'meeting',
          title: updatedTitle,
          status: 'done',
          date: '2025-11-15',
          time: '10:00',
          occurredAt: new Date('2025-11-15T10:00:00.000Z').toISOString(),
        },
      })
      expect(
        putRes.status(),
        `PUT /api/customers/interactions for a legacy-only activity should return 200, got ${putRes.status()}`,
      ).toBe(200)
    } finally {
      // Clean up via the legacy adapter — it understands either side of the
      // bridge and tolerates the bridged row.
      await deleteEntityIfExists(request, token, '/api/customers/activities', activityId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('Schedule Activity dialog prefills date/time from occurredAt when editing a past Meeting', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    let interactionId: string | null = null
    const stamp = Date.now()
    const initialTitle = `QA TC-CRM-054c meeting ${stamp}`
    // Pick a date 30 days ago in the user's local timezone so it falls inside
    // the dialog's default "Last 90 days" history filter while still being
    // unambiguously *not today* — that's what the regression assertion needs.
    const historicalAnchor = new Date()
    historicalAnchor.setDate(historicalAnchor.getDate() - 30)
    historicalAnchor.setHours(14, 30, 0, 0)
    const pad = (value: number) => String(value).padStart(2, '0')
    const historicalDate = `${historicalAnchor.getFullYear()}-${pad(historicalAnchor.getMonth() + 1)}-${pad(historicalAnchor.getDate())}`
    const historicalTime = `${pad(historicalAnchor.getHours())}:${pad(historicalAnchor.getMinutes())}`
    const historicalIso = historicalAnchor.toISOString()

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-054c Co ${stamp}`)

      const createRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          interactionType: 'meeting',
          title: initialTitle,
          status: 'done',
          date: historicalDate,
          time: historicalTime,
          occurredAt: new Date(historicalIso).toISOString(),
        },
      })
      expect(
        createRes.ok(),
        `POST /api/customers/interactions returned ${createRes.status()}`,
      ).toBeTruthy()
      const created = await createRes.json().catch(() => null) as { id?: string } | null
      interactionId = created?.id ?? null
      expect(interactionId, 'create response should expose interaction id').toBeTruthy()

      await login(page, 'admin')
      await page.goto(`/backend/customers/companies-v2/${companyId}`, {
        waitUntil: 'domcontentloaded',
      })

      const activityTab = page.getByRole('tab', { name: /Activity log/i })
      await expect(activityTab).toBeVisible({ timeout: 30_000 })
      await activityTab.click()

      // The historical card lives in ActivityHistorySection. Clicking the
      // ActivityCard chrome opens ScheduleActivityDialog in edit mode. The
      // title text is the most stable click handle inside the test fixture.
      const historicalRow = page.getByText(initialTitle).first()
      await expect(historicalRow).toBeVisible({ timeout: 30_000 })
      await historicalRow.click()

      // The dialog's Date / Start time fields used to be native `<input
      // type="date">` and `<input type="time">`. DS Foundation v3 migrated
      // ScheduleActivityDialog's DateTimeFields to the DS `DatePicker` +
      // `TimePicker` primitives (button triggers over a Popover, no native
      // input). The displayed trigger text is the source of truth for the
      // user-visible value; we assert against the formatted button label so
      // the prefill regression check survives the visual migration.
      const dialog = page.getByRole('dialog')
      const triggers = dialog.locator('button[aria-haspopup="dialog"]')
      const dateTrigger = triggers.nth(0)
      const timeTrigger = triggers.nth(1)
      await expect(dateTrigger).toBeVisible({ timeout: 15_000 })
      await expect(timeTrigger).toBeVisible({ timeout: 15_000 })

      // DatePicker default format is `MMM d, yyyy` (en) — e.g. "Apr 12, 2026".
      // Use a regex so leading-zero variants stay tolerant across locales.
      const expectedDateLabel = (() => {
        const month = historicalAnchor.toLocaleString('en-US', { month: 'short' })
        const day = historicalAnchor.getDate()
        const year = historicalAnchor.getFullYear()
        return `${month} ${day}, ${year}`
      })()
      await expect(
        dateTrigger,
        'Date trigger MUST prefill from occurredAt, NOT today (#1807 prefill)',
      ).toContainText(expectedDateLabel)

      // TimePicker shim renders 12h "hh:mm AM/PM" in the trigger label
      // (matches the slot list inside the popover).
      const expectedTimeLabel = (() => {
        const h24 = historicalAnchor.getHours()
        const h12 = h24 % 12 === 0 ? 12 : h24 % 12
        const hh = String(h12).padStart(2, '0')
        const mm = String(historicalAnchor.getMinutes()).padStart(2, '0')
        const suffix = h24 < 12 ? 'AM' : 'PM'
        return `${hh}:${mm} ${suffix}`
      })()
      await expect(
        timeTrigger,
        'Time trigger MUST prefill from occurredAt projected to the user local zone (#1807 prefill)',
      ).toContainText(expectedTimeLabel)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
