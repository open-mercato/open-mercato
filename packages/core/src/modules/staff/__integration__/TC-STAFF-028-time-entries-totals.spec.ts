import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createTestCustomer, type TestCustomerFixture } from './fixtures'

/**
 * TC-STAFF-028: the time-entries list totals cover the whole filtered set (#6990).
 *
 * `?includeTotals=true` must sum every row the filters match — not the page —
 * and agree with the per-row `cost` the list returns. The entries page shows
 * those totals inside the table frame and each active filter in one chip layer.
 */

const ENTRIES_PATH = '/api/staff/timesheets/time-entries'
const PROJECTS_PATH = '/api/staff/timesheets/time-projects'
const SELF_MEMBER_PATH = '/api/staff/team-members/self'
const ENTRIES_PAGE = '/backend/staff/time-tracking/entries'

const ENTRY_DATES = ['2031-02-03', '2031-02-04', '2031-02-05']
const DURATIONS = [60, 90, 30]
const HOURLY_RATE = 120

type ListBody = {
  items?: Array<Record<string, unknown>>
  total?: number
  totals?: {
    entryCount?: number
    durationMinutes?: number
    roundedMinutes?: number
    money?: Array<{ currencyCode: string | null; amount: number }>
  }
}

async function ensureSelfStaffMemberId(
  request: APIRequestContext,
  token: string,
  displayName: string,
): Promise<{ id: string; created: boolean }> {
  const read = async (): Promise<string | null> => {
    const response = await apiRequest(request, 'GET', SELF_MEMBER_PATH, { token })
    if (!response.ok()) return null
    const body = await readJsonSafe<{ member?: { id?: string } | null }>(response)
    const id = body?.member?.id
    return typeof id === 'string' && id.length > 0 ? id : null
  }
  const existing = await read()
  if (existing) return { id: existing, created: false }
  const response = await apiRequest(request, 'POST', SELF_MEMBER_PATH, { token, data: { displayName } })
  expect(response.ok(), `POST ${SELF_MEMBER_PATH} should create the staff profile: ${response.status()}`).toBeTruthy()
  const created = await read()
  expect(created, 'The staff profile should be readable right after creation').toBeTruthy()
  return { id: created as string, created: true }
}

async function readList(request: APIRequestContext, token: string, query: string): Promise<ListBody> {
  const response = await apiRequest(request, 'GET', `${ENTRIES_PATH}?${query}`, { token })
  expect(response.status(), `GET ${ENTRIES_PATH}?${query}`).toBe(200)
  return ((await readJsonSafe<ListBody>(response)) ?? {}) as ListBody
}

test.describe('TC-STAFF-028: time-entries totals for the whole filtered set', () => {
  test('totals cover every matching row and the page shows them once, inside the table', async ({ page, request }) => {
    test.setTimeout(180_000)

    const stamp = String(Date.now()).slice(-9)
    const token = await getAuthToken(request, 'admin')

    let customer: TestCustomerFixture | null = null
    let projectId: string | null = null
    let selfMember: { id: string; created: boolean } | null = null
    const entryIds: string[] = []

    try {
      selfMember = await ensureSelfStaffMemberId(request, token, `QA028 Member ${stamp}`)
      customer = await createTestCustomer(request, token, { displayName: `QA028 Customer ${stamp}` })

      const projectResponse = await apiRequest(request, 'POST', PROJECTS_PATH, {
        token,
        data: {
          name: `QA028 Project ${stamp}`,
          code: `Q028-${stamp}`,
          customerId: customer.id,
          status: 'active',
          hourlyRate: HOURLY_RATE,
          currencyCode: 'EUR',
          billableByDefault: true,
        },
      })
      expect(projectResponse.ok(), `POST ${PROJECTS_PATH}: ${projectResponse.status()}`).toBeTruthy()
      projectId = ((await readJsonSafe<{ id?: string }>(projectResponse))?.id ?? null) as string | null
      expect(projectId, 'The project create response should carry an id').toBeTruthy()

      const assignResponse = await apiRequest(request, 'POST', `${PROJECTS_PATH}/${projectId}/employees`, {
        token,
        data: { staffMemberId: selfMember.id, status: 'active', assignedStartDate: ENTRY_DATES[0] },
      })
      expect(assignResponse.ok(), `Assigning the member should succeed: ${assignResponse.status()}`).toBeTruthy()

      for (let index = 0; index < ENTRY_DATES.length; index += 1) {
        const entryResponse = await apiRequest(request, 'POST', ENTRIES_PATH, {
          token,
          data: {
            staffMemberId: selfMember.id,
            timeProjectId: projectId,
            date: ENTRY_DATES[index],
            durationMinutes: DURATIONS[index],
            source: 'manual',
            isBillable: true,
            notes: `QA028 entry ${index} ${stamp}`,
          },
        })
        expect(entryResponse.status(), `POST ${ENTRIES_PATH} should create entry ${index}`).toBe(201)
        const id = (await readJsonSafe<{ id?: string }>(entryResponse))?.id
        expect(typeof id === 'string' && id.length > 0).toBeTruthy()
        entryIds.push(id as string)
      }

      const filter = `projectId=${projectId}&from=${ENTRY_DATES[0]}&to=${ENTRY_DATES[2]}`

      const withoutTotals = await readList(request, token, `${filter}&pageSize=1`)
      expect(withoutTotals.totals, 'totals stay off unless requested').toBeUndefined()

      const pageOfOne = await readList(request, token, `${filter}&pageSize=1&includeTotals=true`)
      expect(pageOfOne.items?.length).toBe(1)
      expect(pageOfOne.total).toBe(3)
      expect(pageOfOne.totals?.entryCount, 'totals count the whole filtered set, not the page').toBe(3)
      expect(pageOfOne.totals?.durationMinutes).toBe(DURATIONS.reduce((sum, value) => sum + value, 0))

      const allRows = await readList(request, token, `${filter}&pageSize=50`)
      const roundedSum = (allRows.items ?? []).reduce((sum, row) => sum + Number(row.roundedMinutes ?? row.rounded_minutes ?? 0), 0)
      expect(pageOfOne.totals?.roundedMinutes).toBe(roundedSum)
      const costSum = (allRows.items ?? []).reduce((sum, row) => sum + (typeof row.cost === 'number' ? row.cost : 0), 0)
      expect(pageOfOne.totals?.money, 'the admin holds the rates feature, so money is included').toEqual([
        { currencyCode: 'EUR', amount: Math.round(costSum * 100) / 100 },
      ])

      await login(page, 'admin')
      await page.goto(`${ENTRIES_PAGE}?ids=${entryIds.join(',')}`)
      const footer = page.locator('[data-table-footer] [data-staff-entries-summary-footer]')
      await expect(footer).toBeVisible()
      await expect(footer).toHaveAttribute('data-summary-scope', 'filtered')
      await expect(footer).toContainText('3')

      const chipLayer = page.locator('[data-table-active-filter-chips] [data-staff-entries-filter-chips]')
      await expect(chipLayer).toBeVisible()
      await expect(page.getByTestId('entry-filter-chips')).toHaveCount(1)
      await expect(
        page.locator('button').filter({ hasText: /×\s*$/ }),
        'the filter bar no longer repeats the active filters as its own chip row',
      ).toHaveCount(0)
    } finally {
      for (const entryId of entryIds) {
        await apiRequest(request, 'DELETE', `${ENTRIES_PATH}?id=${encodeURIComponent(entryId)}`, { token }).catch(() => {})
      }
      if (projectId) {
        await apiRequest(request, 'DELETE', `${PROJECTS_PATH}?id=${encodeURIComponent(projectId)}`, { token }).catch(() => {})
      }
      if (customer) await customer.cleanup()
      if (selfMember?.created) {
        await apiRequest(request, 'DELETE', `/api/staff/team-members?id=${encodeURIComponent(selfMember.id)}`, { token }).catch(
          () => {},
        )
      }
    }
  })
})
