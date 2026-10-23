import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-STAFF-028 — Timesheet and My Work targets resolve through the EP-40 capacity
 * registry (#6934).
 *
 * With no capacity provider registered, `GET /api/staff/timesheets/capacity` must
 * answer the built-in flat target, the timesheet footer must keep its
 * "Target (d × h)" caption, and My Work must keep its flat week target. Another
 * person's target is gated on `staff.timesheets.projects.manage`.
 */

const CAPACITY_PATH = '/api/staff/timesheets/capacity'
const SETTINGS_PATH = '/api/staff/timesheets/settings'
const MY_WORK_PATH = '/api/staff/timesheets/my-work'
const SELF_MEMBER_PATH = '/api/staff/team-members/self'
const TEAM_MEMBERS_PATH = '/api/staff/team-members'
const BUILT_IN_PROVIDER_ID = 'staff.time_tracking.capacity.flat_daily_hours'
const WORKING_DAYS_PER_WEEK = 5

type CapacityBody = {
  staffMemberId?: string
  providerId?: string
  isBuiltIn?: boolean
  workingDays?: number
  dailyHours?: number | null
  totalTargetMinutes?: number | null
  targetMinutesByDate?: Record<string, number>
}

type SelfMember = { id: string; created: boolean }

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function currentWeek(): { from: string; to: string } {
  const today = new Date()
  const weekday = today.getDay()
  const monday = new Date(today)
  monday.setDate(today.getDate() + (weekday === 0 ? -6 : 1 - weekday))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { from: formatDateKey(monday), to: formatDateKey(sunday) }
}

async function ensureSelfStaffMember(
  request: APIRequestContext,
  token: string,
  displayName: string,
): Promise<SelfMember> {
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

async function removeSelfStaffMember(request: APIRequestContext, token: string, member: SelfMember | null) {
  if (!member?.created) return
  await apiRequest(request, 'DELETE', `${TEAM_MEMBERS_PATH}?id=${encodeURIComponent(member.id)}`, { token }).catch(
    () => {},
  )
}

async function readDailyHours(request: APIRequestContext, token: string): Promise<number | null> {
  const response = await apiRequest(request, 'GET', SETTINGS_PATH, { token })
  expect(response.ok(), `GET ${SETTINGS_PATH} should succeed: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ targets?: { dailyHours?: number | null } }>(response)
  const dailyHours = body?.targets?.dailyHours
  return typeof dailyHours === 'number' ? dailyHours : null
}

function capacityUrl(range: { from: string; to: string }, staffMemberId?: string): string {
  const params = new URLSearchParams({ from: range.from, to: range.to })
  if (staffMemberId) params.set('staffMemberId', staffMemberId)
  return `${CAPACITY_PATH}?${params.toString()}`
}

test.describe('TC-STAFF-028: Timesheet target follows the EP-40 capacity registry', () => {
  test('resolves the built-in target for the API, the timesheet footer and My Work', async ({ page, request }) => {
    test.setTimeout(120_000)
    const stamp = Date.now()
    const week = currentWeek()
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    let adminMember: SelfMember | null = null
    let employeeMember: SelfMember | null = null

    try {
      adminMember = await ensureSelfStaffMember(request, adminToken, `QA Capacity Admin ${stamp}`)
      employeeMember = await ensureSelfStaffMember(request, employeeToken, `QA Capacity Employee ${stamp}`)
      const dailyHours = await readDailyHours(request, adminToken)
      const expectedWeekMinutes = dailyHours === null ? null : WORKING_DAYS_PER_WEEK * dailyHours * 60

      const ownResponse = await apiRequest(request, 'GET', capacityUrl(week), { token: adminToken })
      expect(ownResponse.status(), 'The caller reads their own target').toBe(200)
      const own = await readJsonSafe<CapacityBody>(ownResponse)
      expect(own?.staffMemberId).toBe(adminMember.id)
      expect(own?.providerId).toBe(BUILT_IN_PROVIDER_ID)
      expect(own?.isBuiltIn).toBe(true)
      expect(own?.workingDays).toBe(WORKING_DAYS_PER_WEEK)
      expect(own?.dailyHours ?? null).toBe(dailyHours)
      expect(own?.totalTargetMinutes ?? null).toBe(expectedWeekMinutes)

      const managerResponse = await apiRequest(request, 'GET', capacityUrl(week, employeeMember.id), {
        token: adminToken,
      })
      expect(managerResponse.status(), "A manager reads another person's target").toBe(200)
      expect((await readJsonSafe<CapacityBody>(managerResponse))?.staffMemberId).toBe(employeeMember.id)

      const forbiddenResponse = await apiRequest(request, 'GET', capacityUrl(week, adminMember.id), {
        token: employeeToken,
      })
      expect(forbiddenResponse.status(), "An employee cannot read another person's target").toBe(403)

      const reversedResponse = await apiRequest(request, 'GET', capacityUrl({ from: week.to, to: week.from }), {
        token: adminToken,
      })
      expect(reversedResponse.status(), 'A reversed period is rejected').toBe(400)

      const myWorkResponse = await apiRequest(request, 'GET', MY_WORK_PATH, { token: adminToken })
      expect(myWorkResponse.status(), `GET ${MY_WORK_PATH} should succeed`).toBe(200)
      const myWork = await readJsonSafe<{ kpis?: { weekTargetMinutes?: number | null } }>(myWorkResponse)
      expect(myWork?.kpis?.weekTargetMinutes ?? null).toBe(expectedWeekMinutes)

      await login(page, 'admin')
      await page.goto('/backend/staff/time-tracking/timesheet?period=week&view=list')
      const footerCaption =
        dailyHours === null ? /^Target:$/ : `Target (${WORKING_DAYS_PER_WEEK} d × ${dailyHours} h):`
      await expect(page.getByText(footerCaption).first()).toBeVisible({ timeout: 30_000 })
    } finally {
      await removeSelfStaffMember(request, employeeToken, employeeMember)
      await removeSelfStaffMember(request, adminToken, adminMember)
    }
  })
})
