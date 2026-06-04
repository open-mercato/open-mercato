import { test, expect } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-STAFF-024: Timesheets time-entries list never 500s on date filters.
 *
 * Regression guard for the background-noise crash where the timer/dashboard
 * widgets poll `/api/staff/timesheets/time-entries?...&from=<date>&to=<date>`
 * and an unparseable date string reached the query engine and threw a 500.
 * The route now validates `from`/`to` as dates, so valid widget queries return
 * 200 and malformed dates are rejected with 400 instead of crashing.
 */
test.describe('TC-STAFF-024: time-entries list date filters', () => {
  test('valid widget-style date filter returns 200 (smoke)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const selfRes = await apiRequest(request, 'GET', '/api/staff/team-members/self', { token })
    expect(selfRes.status()).toBe(200)
    const selfBody = (await selfRes.json()) as { member?: { id?: string } }
    const memberId = selfBody.member?.id ?? ''
    expect(memberId.length > 0, 'Admin must resolve a staff member profile').toBeTruthy()

    const today = new Date().toISOString().slice(0, 10)
    const res = await apiRequest(
      request,
      'GET',
      `/api/staff/timesheets/time-entries?staffMemberId=${memberId}&from=${today}&to=${today}&pageSize=50`,
      { token },
    )

    expect(res.status()).toBe(200)
    const body = (await res.json()) as { items?: unknown[]; total?: number }
    expect(Array.isArray(body.items)).toBeTruthy()
    expect(typeof body.total).toBe('number')
  })

  test('malformed date filter returns 400, not 500', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    // Partial/parseable-but-not-full and otherwise malformed dates must be
    // rejected with 400 before they reach Postgres (where e.g. '2026'::date 500s).
    for (const badDate of ['invalid-date', '2026-13-45', 'NaN-NaN-NaN', '2026', '2026-06']) {
      const fromRes = await apiRequest(
        request,
        'GET',
        `/api/staff/timesheets/time-entries?from=${encodeURIComponent(badDate)}&pageSize=50`,
        { token },
      )
      expect(fromRes.status(), `from=${badDate} must not crash the route`).toBe(400)

      const toRes = await apiRequest(
        request,
        'GET',
        `/api/staff/timesheets/time-entries?to=${encodeURIComponent(badDate)}&pageSize=50`,
        { token },
      )
      expect(toRes.status(), `to=${badDate} must not crash the route`).toBe(400)
    }
  })

  test('literal "undefined" date filter returns 400, not 500', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    // Guards against clients that interpolate an unset date as the string
    // 'undefined' (e.g. `from=${dateRange.from}` when dateRange.from is undefined).
    const res = await apiRequest(
      request,
      'GET',
      '/api/staff/timesheets/time-entries?from=undefined&to=undefined&pageSize=50',
      { token },
    )
    expect(res.status(), 'from=undefined must not crash the route').toBe(400)
  })

  test('empty and omitted date filters return 200 with the paged shape', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const emptyRes = await apiRequest(
      request,
      'GET',
      '/api/staff/timesheets/time-entries?from=&to=&pageSize=50',
      { token },
    )
    expect(emptyRes.status(), 'empty from/to are skipped, not rejected').toBe(200)

    const bareRes = await apiRequest(
      request,
      'GET',
      '/api/staff/timesheets/time-entries?pageSize=50',
      { token },
    )
    expect(bareRes.status(), 'bare list (no date params) must return 200').toBe(200)
    const bareBody = (await bareRes.json()) as { items?: unknown[]; total?: number }
    expect(Array.isArray(bareBody.items)).toBeTruthy()
    expect(typeof bareBody.total).toBe('number')
  })
})
