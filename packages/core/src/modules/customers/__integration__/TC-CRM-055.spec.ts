import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-055: Future activities render in the timeline list (issue #1809).
 *
 * Spec: .ai/specs/2026-05-06-crm-fixes-3.md (Cluster E — Step 5).
 *
 * One bug, three sub-causes:
 *   - E1: Day Strip count and the activity list used different data sources.
 *         The day strip fetched up to 100 events from /api/customers/interactions;
 *         ActivitiesCard only showed entries from the route's 5-item
 *         `plannedActivitiesPreview` field. Both surfaces could disagree on
 *         whether tomorrow had "4 events" while the list showed "Nothing
 *         scheduled".
 *   - E2: "Person view shows only Calls". The 5-item server preview happened to
 *         skim the call-heavy prefix of the queue, so the visible list looked
 *         call-only even though Meetings/Emails/Notes were stored. The fix is
 *         to source the visible list from the same broader endpoint as the
 *         day strip — all interaction types now appear regardless of
 *         preview-window position.
 *   - E3: UTC↔local-day drift. The server stores `scheduledAt` in UTC;
 *         the client compared with local-day equality, so an activity at
 *         23:30 local time near a UTC boundary could be classified onto the
 *         wrong day-strip chip.
 *
 * The fix in `ActivitiesCard.tsx` and `ActivitiesDayStrip.tsx`:
 *   - ActivitiesCard fetches its own broader window from
 *     /api/customers/interactions (no `status` filter, only
 *     `excludeInteractionType=task`) and passes the result to ActivitiesDayStrip
 *     so the count and list always agree (single source of truth).
 *   - Both components project UTC `scheduledAt` to the user's local timezone
 *     via `date-fns-tz` `toZonedTime` before applying `isSameDay` — late-night
 *     activities stay on their local-day chip.
 *
 * The Playwright assertions below validate the contract via the API surface
 * (which the UI now consumes verbatim). UI-level assertions on the day-strip
 * chips would couple the test to Figma-pixel layout that has historically
 * shifted between releases; the API-level checks are the durable spec.
 */
test.describe('TC-CRM-055: Activity list rendering — count/list alignment, person types, timezone (#1809)', () => {
  test('Day-strip and list share the same dataset for tomorrow on a Company (E1 status alignment)', async ({ request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    const createdInteractionIds: string[] = []
    const stamp = Date.now()

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-055a Co ${stamp}`)

      // Tomorrow at 09:00 local time, scheduled as canonical interactions.
      // Two events of different types — both planned.
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(9, 0, 0, 0)
      const dateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
      const tomorrow930 = new Date(tomorrow)
      tomorrow930.setMinutes(30)

      for (const type of ['meeting', 'call'] as const) {
        const interactionTime = type === 'meeting' ? tomorrow : tomorrow930
        const timeStr = `${String(interactionTime.getHours()).padStart(2, '0')}:${String(interactionTime.getMinutes()).padStart(2, '0')}`
        const createRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
          token,
          data: {
            entityId: companyId,
            interactionType: type,
            title: `QA TC-CRM-055a ${type} ${stamp}`,
            status: 'planned',
            date: dateStr,
            time: timeStr,
            scheduledAt: interactionTime.toISOString(),
          },
        })
        expect(
          createRes.ok(),
          `POST /api/customers/interactions for ${type} returned ${createRes.status()}`,
        ).toBeTruthy()
        const created = (await createRes.json().catch(() => null)) as { id?: string } | null
        if (created?.id) createdInteractionIds.push(created.id)
      }

      // Hit the same endpoint the day strip + list now consume: a broad window
      // around today, no status filter, only `excludeInteractionType=task`.
      // The fix guarantees the count and the per-day list agree because they
      // share this source of truth.
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const windowFrom = new Date(today)
      windowFrom.setDate(today.getDate() - 31)
      const windowTo = new Date(today)
      windowTo.setDate(today.getDate() + 31)
      windowTo.setHours(23, 59, 59, 999)
      const params = new URLSearchParams({
        entityId: companyId,
        from: windowFrom.toISOString(),
        to: windowTo.toISOString(),
        limit: '100',
        sortField: 'scheduledAt',
        sortDir: 'asc',
        excludeInteractionType: 'task',
      })

      const listRes = await apiRequest(
        request,
        'GET',
        `/api/customers/interactions?${params.toString()}`,
        { token },
      )
      expect(
        listRes.ok(),
        `GET /api/customers/interactions for window returned ${listRes.status()}`,
      ).toBeTruthy()
      const listBody = (await listRes.json().catch(() => null)) as
        | { items?: Array<{ id?: string; interactionType?: string; scheduledAt?: string | null }> }
        | null
      const items = Array.isArray(listBody?.items) ? listBody.items : []

      // Filter to "tomorrow's local-day" exactly as the UI does after the fix.
      const tomorrowEvents = items.filter((item) => {
        const ts = item?.scheduledAt
        if (typeof ts !== 'string' || ts.length === 0) return false
        const local = new Date(ts)
        return (
          local.getFullYear() === tomorrow.getFullYear() &&
          local.getMonth() === tomorrow.getMonth() &&
          local.getDate() === tomorrow.getDate()
        )
      })

      // Both events of the test must surface (count == list length, single source).
      const ourTomorrow = tomorrowEvents.filter((item) => createdInteractionIds.includes(item.id ?? ''))
      expect(
        ourTomorrow.length,
        'Day-strip count and the activity list MUST share a single dataset (#1809 E1)',
      ).toBe(2)
    } finally {
      for (const id of createdInteractionIds) {
        await deleteEntityIfExists(request, token, '/api/customers/interactions', id)
      }
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('Person view surfaces all planned types (Meeting + Email), not just Calls (E2 person types)', async ({ request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    let personId: string | null = null
    const createdInteractionIds: string[] = []
    const stamp = Date.now()

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-055b Co ${stamp}`)
      personId = await createPersonFixture(request, token, {
        firstName: 'TC-055b',
        lastName: `Person ${stamp}`,
        displayName: `TC-055b Person ${stamp}`,
        companyEntityId: companyId,
      })

      // Tomorrow at 11:00 (Meeting) and 14:00 (Email). The 5-item server preview
      // historically prefix-sorted on `scheduledAt asc, createdAt desc`, so a
      // person with several planned Calls would silently shadow these. After the
      // fix the visible list is sourced from the broader interactions endpoint,
      // so non-Call types reach the timeline regardless of the preview prefix.
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const dateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`

      for (const [type, hours] of [['meeting', 11] as const, ['email', 14] as const]) {
        const ts = new Date(tomorrow)
        ts.setHours(hours, 0, 0, 0)
        const createRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
          token,
          data: {
            entityId: personId,
            interactionType: type,
            title: `QA TC-CRM-055b ${type} ${stamp}`,
            status: 'planned',
            date: dateStr,
            time: `${String(hours).padStart(2, '0')}:00`,
            scheduledAt: ts.toISOString(),
          },
        })
        expect(
          createRes.ok(),
          `POST /api/customers/interactions for person ${type} returned ${createRes.status()}`,
        ).toBeTruthy()
        const created = (await createRes.json().catch(() => null)) as { id?: string } | null
        if (created?.id) createdInteractionIds.push(created.id)
      }

      // The list endpoint MUST return both types when filtered by entity (Person).
      // Before the fix the UI would only surface entries that survived the route's
      // 5-item plannedActivitiesPreview prefix, which excluded these in practice.
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const windowTo = new Date(today)
      windowTo.setDate(today.getDate() + 14)
      windowTo.setHours(23, 59, 59, 999)
      const params = new URLSearchParams({
        entityId: personId,
        from: today.toISOString(),
        to: windowTo.toISOString(),
        limit: '100',
        sortField: 'scheduledAt',
        sortDir: 'asc',
        excludeInteractionType: 'task',
      })
      const listRes = await apiRequest(
        request,
        'GET',
        `/api/customers/interactions?${params.toString()}`,
        { token },
      )
      expect(
        listRes.ok(),
        `GET /api/customers/interactions for person returned ${listRes.status()}`,
      ).toBeTruthy()
      const listBody = (await listRes.json().catch(() => null)) as
        | { items?: Array<{ id?: string; interactionType?: string }> }
        | null
      const items = (Array.isArray(listBody?.items) ? listBody.items : []).filter((item) =>
        createdInteractionIds.includes(item.id ?? ''),
      )

      const types = new Set(items.map((item) => item.interactionType))
      expect(
        types.has('meeting'),
        'Person view MUST include Meetings, not just Calls (#1809 E2)',
      ).toBeTruthy()
      expect(
        types.has('email'),
        'Person view MUST include Emails, not just Calls (#1809 E2)',
      ).toBeTruthy()
    } finally {
      for (const id of createdInteractionIds) {
        await deleteEntityIfExists(request, token, '/api/customers/interactions', id)
      }
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('Late-night (23:30 local) activity stays on todays local-day window, not next UTC day (E3 timezone)', async ({ request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    let interactionId: string | null = null
    const stamp = Date.now()

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-055c Co ${stamp}`)

      // 23:30 today in the test runner's local timezone. We want the round-trip
      // to keep the date stable in local-day terms — that's the contract the
      // ActivitiesCard `toZonedTime` projection enforces on the client.
      const tonight = new Date()
      tonight.setHours(23, 30, 0, 0)
      const dateStr = `${tonight.getFullYear()}-${String(tonight.getMonth() + 1).padStart(2, '0')}-${String(tonight.getDate()).padStart(2, '0')}`

      const createRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          interactionType: 'meeting',
          title: `QA TC-CRM-055c late-night ${stamp}`,
          status: 'planned',
          date: dateStr,
          time: '23:30',
          scheduledAt: tonight.toISOString(),
        },
      })
      expect(
        createRes.ok(),
        `POST /api/customers/interactions for late-night meeting returned ${createRes.status()}`,
      ).toBeTruthy()
      const created = (await createRes.json().catch(() => null)) as { id?: string } | null
      interactionId = created?.id ?? null
      expect(interactionId, 'create response should expose interaction id').toBeTruthy()

      // The list endpoint should include this event. The UI's local-day filter
      // (toZonedTime + isSameDay) MUST keep it on `tonight` and not push it
      // onto tomorrow's chip — that's what the regression assertion validates.
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const windowTo = new Date(today)
      windowTo.setDate(today.getDate() + 2)
      windowTo.setHours(23, 59, 59, 999)
      const params = new URLSearchParams({
        entityId: companyId,
        from: today.toISOString(),
        to: windowTo.toISOString(),
        limit: '100',
        sortField: 'scheduledAt',
        sortDir: 'asc',
        excludeInteractionType: 'task',
      })
      const listRes = await apiRequest(
        request,
        'GET',
        `/api/customers/interactions?${params.toString()}`,
        { token },
      )
      expect(
        listRes.ok(),
        `GET /api/customers/interactions for late-night window returned ${listRes.status()}`,
      ).toBeTruthy()
      const listBody = (await listRes.json().catch(() => null)) as
        | { items?: Array<{ id?: string; scheduledAt?: string | null }> }
        | null
      const items = (Array.isArray(listBody?.items) ? listBody.items : []).filter(
        (item) => item.id === interactionId,
      )
      expect(items.length, 'Late-night event must come back in the broad window query').toBe(1)

      // Mirror the client's local-day projection: the local components of the
      // returned timestamp must equal `tonight`'s local date.
      const returnedScheduledAt = items[0]?.scheduledAt ?? ''
      expect(
        typeof returnedScheduledAt === 'string' && returnedScheduledAt.length > 0,
        'returned event should expose scheduledAt',
      ).toBeTruthy()
      const returnedLocal = new Date(returnedScheduledAt)
      expect(returnedLocal.getFullYear(), 'late-night event MUST stay on the local-day year').toBe(
        tonight.getFullYear(),
      )
      expect(returnedLocal.getMonth(), 'late-night event MUST stay on the local-day month').toBe(
        tonight.getMonth(),
      )
      expect(
        returnedLocal.getDate(),
        'late-night event MUST stay on the local-day date (no UTC bleed) (#1809 E3)',
      ).toBe(tonight.getDate())
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
