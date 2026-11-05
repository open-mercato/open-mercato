import { randomInt } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-STAFF-049 — Timesheet and My Work targets resolve through the EP-40 capacity
 * registry (#6934).
 *
 * With no capacity provider registered, `GET /api/staff/timesheets/capacity` must
 * answer the built-in flat target, the timesheet footer must keep its
 * "Target (d × h)" caption, and My Work must keep its flat week target. Another
 * person's target is gated on `staff.timesheets.projects.manage`, and a staff member
 * outside the caller's tenant or organization is a 404 even with that grant.
 *
 * The contributed case registers the example module's QA probe through the real
 * `registerCapacityProvider` registry (`POST /api/example/qa-capacity-probe`, live
 * only under `OM_INTEGRATION_TEST`) and follows its zero-Monday, reduced-weekday
 * schedule from the capacity API through My Work to the Timesheet footer and day rows.
 */

const CAPACITY_PATH = '/api/staff/timesheets/capacity'
const SETTINGS_PATH = '/api/staff/timesheets/settings'
const MY_WORK_PATH = '/api/staff/timesheets/my-work'
const SELF_MEMBER_PATH = '/api/staff/team-members/self'
const TEAM_MEMBERS_PATH = '/api/staff/team-members'
const TENANTS_PATH = '/api/directory/tenants'
const CAPACITY_PROBE_PATH = '/api/example/qa-capacity-probe'
const BUILT_IN_PROVIDER_ID = 'staff.time_tracking.capacity.flat_daily_hours'
const PROBE_PROVIDER_ID = 'example.qa_capacity_probe'
const PROBE_LABEL = 'QA capacity probe'
const PROBE_DAY_MINUTES = 120
const WORKING_DAYS_PER_WEEK = 5
const MONDAY = 1

type CapacityBody = {
  staffMemberId?: string
  providerId?: string
  isBuiltIn?: boolean
  label?: string | null
  workingDays?: number
  dailyHours?: number | null
  totalTargetMinutes?: number | null
  targetMinutesByDate?: Record<string, number>
  error?: string
}

type MyWorkKpis = {
  dailyTargetMinutes?: number | null
  weekTargetMinutes?: number | null
  monthTargetMinutes?: number | null
}

type SelfMember = { id: string; created: boolean }

type ScopedMember = { id: string; tenantId: string; organizationId: string }

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateKey(isoDay: string): Date {
  const [year, month, day] = isoDay.split('-').map(Number)
  return new Date(year, month - 1, day)
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

function eachDay(range: { from: string; to: string }): string[] {
  const days: string[] = []
  const cursor = parseDateKey(range.from)
  const end = parseDateKey(range.to)
  while (cursor <= end) {
    days.push(formatDateKey(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

function isWeekday(isoDay: string): boolean {
  const weekday = parseDateKey(isoDay).getDay()
  return weekday !== 0 && weekday !== 6
}

function probeTargetFor(isoDay: string): number | undefined {
  if (!isWeekday(isoDay)) return undefined
  return parseDateKey(isoDay).getDay() === MONDAY ? 0 : PROBE_DAY_MINUTES
}

function probeTotalFor(range: { from: string; to: string }): number {
  return eachDay(range).reduce((sum, isoDay) => sum + (probeTargetFor(isoDay) ?? 0), 0)
}

function currentMonth(): { from: string; to: string } {
  const today = new Date()
  const first = new Date(today.getFullYear(), today.getMonth(), 1)
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  return { from: formatDateKey(first), to: formatDateKey(last) }
}

function formatClock(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes))
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

function formatDayLabel(isoDay: string): string {
  return new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' }).format(
    parseDateKey(isoDay),
  )
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

/**
 * Deletes only the staff profiles this test created, through a caller holding
 * `staff.manage_team`. Every deletion is attempted before the soft assertion records
 * any failure, so one rejected delete never leaves the others behind and a cleanup
 * failure never masks the error that sent the test into `finally`.
 */
async function removeCreatedSelfStaffMembers(
  request: APIRequestContext,
  managerToken: string,
  members: Array<SelfMember | null>,
): Promise<void> {
  const failures: string[] = []
  for (const member of members) {
    if (!member?.created) continue
    const response = await apiRequest(request, 'DELETE', `${TEAM_MEMBERS_PATH}?id=${encodeURIComponent(member.id)}`, {
      token: managerToken,
    }).catch(() => null)
    if (!response?.ok()) failures.push(`${member.id}: ${response ? response.status() : 'request failed'}`)
  }
  expect.soft(failures, 'Every staff profile the test created is deleted by an authorized caller').toEqual([])
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

function scopedHeaders(token: string, tenantId: string, organizationId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Cookie: `om_selected_tenant=${tenantId}; om_selected_org=${organizationId}`,
  }
}

function resolveUrl(path: string): string {
  const baseUrl = process.env.BASE_URL?.trim()
  return baseUrl ? `${baseUrl}${path}` : path
}

async function createTenantFixture(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', TENANTS_PATH, { token, data: { name } })
  expect(response.status(), 'The foreign tenant fixture should be created').toBe(201)
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'The tenant response should include an id')
}

async function readMemberScope(memberId: string): Promise<{ tenantId: string; organizationId: string } | null> {
  return withClient(async (client) => {
    const result = await client.query<{ tenant_id: string; organization_id: string }>(
      'select tenant_id, organization_id from staff_team_members where id = $1',
      [memberId],
    )
    const row = result.rows[0]
    return row ? { tenantId: row.tenant_id, organizationId: row.organization_id } : null
  })
}

async function createScopedStaffMember(
  request: APIRequestContext,
  superadminToken: string,
  scope: { tenantId: string; organizationId: string },
  displayName: string,
): Promise<ScopedMember> {
  const response = await request.fetch(resolveUrl(TEAM_MEMBERS_PATH), {
    method: 'POST',
    headers: scopedHeaders(superadminToken, scope.tenantId, scope.organizationId),
    data: { displayName },
  })
  expect(response.status(), `POST ${TEAM_MEMBERS_PATH} in a foreign scope should succeed`).toBe(201)
  const id = expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'The staff member response should include an id')
  const stored = await readMemberScope(id)
  expect(stored, 'The foreign staff member must land in the requested tenant and organization').toEqual(scope)
  return { id, ...scope }
}

async function deleteScopedStaffMember(
  request: APIRequestContext,
  superadminToken: string,
  member: ScopedMember | null,
): Promise<void> {
  if (!member) return
  await request
    .fetch(resolveUrl(`${TEAM_MEMBERS_PATH}?id=${encodeURIComponent(member.id)}`), {
      method: 'DELETE',
      headers: scopedHeaders(superadminToken, member.tenantId, member.organizationId),
    })
    .catch(() => undefined)
}

async function setCapacityProbe(request: APIRequestContext, token: string, active: boolean): Promise<void> {
  const response = await apiRequest(request, active ? 'POST' : 'DELETE', CAPACITY_PROBE_PATH, { token })
  expect(response.status(), `${active ? 'POST' : 'DELETE'} ${CAPACITY_PROBE_PATH} should succeed`).toBe(200)
}

async function readDayRowTotal(page: Page, isoDay: string): Promise<{ total: number; text: string }> {
  const row = page.locator('button[aria-expanded]').filter({ hasText: formatDayLabel(isoDay) }).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  const text = (await row.innerText()).replace(/\s+/g, ' ')
  const clock = /(\d+):(\d{2})/.exec(text.split(' below target')[0])
  const startsWithDash = /—/.test(text)
  const total = startsWithDash || !clock ? 0 : Number(clock[1]) * 60 + Number(clock[2])
  return { total, text }
}

test.describe('TC-STAFF-049: Timesheet target follows the EP-40 capacity registry', () => {
  test('resolves the built-in target for the API, the timesheet footer and My Work', async ({ page, request }) => {
    test.setTimeout(120_000)
    const stamp = Date.now()
    const week = currentWeek()
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    let adminMember: SelfMember | null = null
    let employeeMember: SelfMember | null = null

    try {
      await setCapacityProbe(request, adminToken, false)
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
      const myWork = await readJsonSafe<{ kpis?: MyWorkKpis }>(myWorkResponse)
      expect(myWork?.kpis?.weekTargetMinutes ?? null).toBe(expectedWeekMinutes)

      await login(page, 'admin')
      await page.goto('/backend/staff/time-tracking/timesheet?period=week&view=list')
      const footerCaption =
        dailyHours === null ? /^Target:$/ : `Target (${WORKING_DAYS_PER_WEEK} d × ${dailyHours} h):`
      await expect(page.getByText(footerCaption).first()).toBeVisible({ timeout: 30_000 })
    } finally {
      await removeCreatedSelfStaffMembers(request, adminToken, [employeeMember, adminMember])
    }
  })

  test('answers 404 and no capacity data for staff members of another tenant or organization', async ({
    request,
  }) => {
    test.setTimeout(120_000)
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const week = currentWeek()
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminScope = getTokenContext(adminToken)
    let adminMember: SelfMember | null = null
    let foreignOrganizationId: string | null = null
    let foreignTenantId: string | null = null
    let foreignTenantOrganizationId: string | null = null
    let foreignOrgMember: ScopedMember | null = null
    let foreignTenantMember: ScopedMember | null = null

    try {
      expect(adminScope.tenantId, 'The admin token carries a tenant').toBeTruthy()
      expect(adminScope.organizationId, 'The admin token carries an organization').toBeTruthy()
      adminMember = await ensureSelfStaffMember(request, adminToken, `QA Capacity Scope Admin ${stamp}`)

      foreignOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA Capacity Foreign Org ${stamp}`,
        tenantId: adminScope.tenantId,
      })
      foreignOrgMember = await createScopedStaffMember(
        request,
        superadminToken,
        { tenantId: adminScope.tenantId, organizationId: foreignOrganizationId },
        `QA Capacity Foreign Org Member ${stamp}`,
      )

      foreignTenantId = await createTenantFixture(request, superadminToken, `QA Capacity Foreign Tenant ${stamp}`)
      foreignTenantOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA Capacity Foreign Tenant Org ${stamp}`,
        tenantId: foreignTenantId,
      })
      foreignTenantMember = await createScopedStaffMember(
        request,
        superadminToken,
        { tenantId: foreignTenantId, organizationId: foreignTenantOrganizationId },
        `QA Capacity Foreign Tenant Member ${stamp}`,
      )

      const ownResponse = await apiRequest(request, 'GET', capacityUrl(week, adminMember.id), { token: adminToken })
      expect(ownResponse.status(), 'The same caller reads an in-scope staff member').toBe(200)

      for (const [label, member] of [
        ['another organization of the same tenant', foreignOrgMember],
        ['another tenant', foreignTenantMember],
      ] as const) {
        const response = await apiRequest(request, 'GET', capacityUrl(week, member.id), { token: adminToken })
        expect(response.status(), `A manager cannot read a staff member of ${label}`).toBe(404)
        const body = await readJsonSafe<CapacityBody>(response)
        expect(typeof body?.error, `The 404 for ${label} carries only an error`).toBe('string')
        expect(body?.staffMemberId, `The 404 for ${label} names no staff member`).toBeUndefined()
        expect(body?.providerId, `The 404 for ${label} names no provider`).toBeUndefined()
        expect(body?.targetMinutesByDate, `The 404 for ${label} carries no per-day targets`).toBeUndefined()
        expect(body?.totalTargetMinutes, `The 404 for ${label} carries no total`).toBeUndefined()
      }
    } finally {
      await deleteScopedStaffMember(request, superadminToken, foreignTenantMember)
      await deleteScopedStaffMember(request, superadminToken, foreignOrgMember)
      await deleteOrganizationIfExists(request, superadminToken, foreignTenantOrganizationId)
      await deleteOrganizationIfExists(request, superadminToken, foreignOrganizationId)
      await deleteGeneralEntityIfExists(request, superadminToken, TENANTS_PATH, foreignTenantId)
      await removeCreatedSelfStaffMembers(request, adminToken, [adminMember])
    }
  })

  test('carries a contributed provider target to the API, My Work and the timesheet', async ({ page, request }) => {
    test.setTimeout(150_000)
    const stamp = Date.now()
    const week = currentWeek()
    const month = currentMonth()
    const today = formatDateKey(new Date())
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    let adminMember: SelfMember | null = null
    let employeeMember: SelfMember | null = null
    let probeActive = false

    try {
      adminMember = await ensureSelfStaffMember(request, adminToken, `QA Capacity Probe Admin ${stamp}`)
      employeeMember = await ensureSelfStaffMember(request, employeeToken, `QA Capacity Probe Employee ${stamp}`)
      await setCapacityProbe(request, adminToken, true)
      probeActive = true

      const expectedByDate: Record<string, number> = {}
      for (const isoDay of eachDay(week)) {
        const target = probeTargetFor(isoDay)
        if (target !== undefined) expectedByDate[isoDay] = target
      }
      const expectedWeekMinutes = probeTotalFor(week)

      const ownResponse = await apiRequest(request, 'GET', capacityUrl(week), { token: adminToken })
      expect(ownResponse.status(), 'The caller reads their contributed target').toBe(200)
      const own = await readJsonSafe<CapacityBody>(ownResponse)
      expect(own?.staffMemberId).toBe(adminMember.id)
      expect(own?.providerId).toBe(PROBE_PROVIDER_ID)
      expect(own?.isBuiltIn).toBe(false)
      expect(own?.label).toBe(PROBE_LABEL)
      expect(own?.targetMinutesByDate).toEqual(expectedByDate)
      expect(own?.totalTargetMinutes).toBe(expectedWeekMinutes)

      const managerResponse = await apiRequest(request, 'GET', capacityUrl(week, employeeMember.id), {
        token: adminToken,
      })
      expect(managerResponse.status(), "A manager reads another person's contributed target").toBe(200)
      const managed = await readJsonSafe<CapacityBody>(managerResponse)
      expect(managed?.staffMemberId).toBe(employeeMember.id)
      expect(managed?.providerId).toBe(PROBE_PROVIDER_ID)
      expect(managed?.totalTargetMinutes).toBe(expectedWeekMinutes)

      const myWorkResponse = await apiRequest(request, 'GET', MY_WORK_PATH, { token: adminToken })
      expect(myWorkResponse.status(), `GET ${MY_WORK_PATH} should succeed`).toBe(200)
      const kpis = (await readJsonSafe<{ kpis?: MyWorkKpis }>(myWorkResponse))?.kpis
      expect(kpis?.weekTargetMinutes, 'My Work week target is the contributed total').toBe(expectedWeekMinutes)
      expect(kpis?.monthTargetMinutes, 'My Work month target is the contributed total').toBe(probeTotalFor(month))
      const todayTarget = probeTargetFor(today)
      expect(kpis?.dailyTargetMinutes ?? null, "My Work today target is the contributed day's").toBe(
        todayTarget && todayTarget > 0 ? todayTarget : null,
      )

      await login(page, 'admin')
      await page.goto('/backend/staff/time-tracking/timesheet?period=week&view=list')
      const footerTarget = page.getByText(`${PROBE_LABEL}:`, { exact: true }).first()
      await expect(footerTarget, 'The footer shows the provider label').toBeVisible({ timeout: 30_000 })
      await expect(footerTarget.locator('..'), 'The footer shows the contributed total').toContainText(
        formatClock(expectedWeekMinutes),
      )
      await expect(page.getByText(/^Target \(\d+ d × [\d.]+ h\):$/)).toHaveCount(0)

      for (const isoDay of eachDay(week).filter(isWeekday)) {
        const { total, text } = await readDayRowTotal(page, isoDay)
        const target = expectedByDate[isoDay]
        if (target > 0 && total < target) {
          expect(text, `${isoDay} is compared against the contributed ${formatClock(target)}`).toContain(
            `${formatClock(target - total)} below target`,
          )
        } else {
          expect(text, `${isoDay} carries no shortfall against a ${formatClock(target)} target`).not.toContain(
            'below target',
          )
        }
      }

      await setCapacityProbe(request, adminToken, false)
      probeActive = false
      const restoredResponse = await apiRequest(request, 'GET', capacityUrl(week), { token: adminToken })
      expect(restoredResponse.status(), 'The caller still reads their target after the probe is withdrawn').toBe(200)
      const restored = await readJsonSafe<CapacityBody>(restoredResponse)
      expect(restored?.staffMemberId).toBe(adminMember.id)
      expect(restored?.providerId, 'Disposing the probe restores the built-in').toBe(BUILT_IN_PROVIDER_ID)
      expect(restored?.isBuiltIn, 'Disposing the probe restores the built-in').toBe(true)
    } finally {
      if (probeActive) await setCapacityProbe(request, adminToken, false).catch(() => undefined)
      await removeCreatedSelfStaffMembers(request, adminToken, [employeeMember, adminMember])
    }
  })
})
