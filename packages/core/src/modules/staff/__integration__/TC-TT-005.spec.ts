import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  assignEmployeeToProjectFixture,
  createTimeEntryFixture,
  deleteStaffEntityIfExists,
} from '@open-mercato/core/helpers/integration/timesheetFixtures'
import { createTestTimeProject, type TestTimeProjectFixture } from './fixtures'

export const integrationMeta = {
  dependsOnModules: ['customers'],
}

/**
 * TC-TT-005 — Project team drawer (screen 5).
 *
 * Source: `.ai/specs/2026-08-12-time-tracking-consulting-suite.md`
 *   § Testing Coverage → Integration → "Assign a member; access is immediate without
 *   re-login".
 *   Screen 5 note 1 (US-B2) — access works the moment the drawer is saved; there is no
 *   invitation step and no re-login.
 *   Screen 5 note 2 (§3) — the Team Leader row is not de-selectable: their access comes
 *   from the `staff.timesheets.projects.manage` feature, not from an assignment.
 *   Screen 5 note 3 — un-assigning somebody who has logged hours asks first, naming the
 *   hours, and the drawer states that revoking access keeps the entries.
 *   D-12 — an assignment whose `assigned_end_date` plus the grace period has passed is
 *   shown as expired.
 *
 * Personas: `admin` is the Team Leader (`setup.ts` grants it `staff.*`, which contains
 * `staff.timesheets.projects.manage` — the drawer only mounts for that feature).
 * `employee` is the plain Team Member (`setup.ts` grants it the Team Member set without
 * `projects.manage`). Both are `mercato init` accounts, which is the precedent the rest
 * of this folder follows (TC-STAFF-020, TC-STAFF-027); no bespoke role fixture is needed.
 *
 * Self-contained: customer, project, membership, staff profile and time entry are all
 * created in setup and removed in `finally`, including when the body throws.
 */

const EMPLOYEES_PATH = (projectId: string) => `/api/staff/timesheets/time-projects/${projectId}/employees`
const TIME_ENTRIES_PATH = '/api/staff/timesheets/time-entries'
const TIMESHEET_PAGE = '/backend/staff/time-tracking/timesheet'
const TEAM_DRAWER_PAGE = (projectId: string) => `/backend/staff/time-tracking/projects/${projectId}?panel=team`

type SelfStaffMember = { id: string; displayName: string }

async function readSelfStaffMember(
  request: APIRequestContext,
  token: string,
): Promise<SelfStaffMember | null> {
  const response = await apiRequest(request, 'GET', '/api/staff/team-members/self', { token })
  if (!response.ok()) return null
  const body = await readJsonSafe<{ member?: { id?: string; displayName?: string } | null }>(response)
  const id = body?.member?.id
  if (typeof id !== 'string' || id.length === 0) return null
  return { id, displayName: body?.member?.displayName ?? id }
}

/**
 * The locked row only exists when the acting Team Leader has a staff profile of their
 * own, and the seeded `admin` account may not have one. Creating it is the only way to
 * assert screen 5 note 2 deterministically; the profile is removed again in `finally`
 * when (and only when) this spec created it.
 */
async function ensureSelfStaffMember(
  request: APIRequestContext,
  token: string,
  displayName: string,
): Promise<{ member: SelfStaffMember; created: boolean }> {
  const existing = await readSelfStaffMember(request, token)
  if (existing) return { member: existing, created: false }

  const response = await apiRequest(request, 'POST', '/api/staff/team-members/self', {
    token,
    data: { displayName },
  })
  expect(response.ok(), `POST /api/staff/team-members/self should create the leader profile: ${response.status()}`).toBeTruthy()
  const created = await readSelfStaffMember(request, token)
  expect(created, 'The Team Leader profile should be readable right after creation').toBeTruthy()
  return { member: created as SelfStaffMember, created: true }
}

function isoDaysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Whether the Team Member can reach the project from their own timesheet — either it
 * already sits in the grid, or it is offered by the "Add row" picker, which is fed by
 * the caller's project memberships.
 */
async function timesheetOffersProject(page: Page, projectName: string): Promise<boolean> {
  await page.goto(TIMESHEET_PAGE)
  const addRowButton = page.getByRole('button', { name: 'Add row' }).first()
  const emptyState = page.getByText('No projects assigned yet').first()
  await expect(addRowButton.or(emptyState)).toBeVisible({ timeout: 30_000 })

  if (await page.getByText(projectName, { exact: true }).first().isVisible().catch(() => false)) return true
  if (!(await addRowButton.isVisible().catch(() => false))) return false

  await addRowButton.click()
  await page.getByPlaceholder('Search by project').fill(projectName)
  return page.getByRole('button', { name: projectName }).first().isVisible().catch(() => false)
}

test.describe('TC-TT-005: Project team drawer', () => {
  test('grants a member access immediately without re-login and keeps the Team Leader row locked', async ({ page, request }) => {
    test.setTimeout(180_000)

    const stamp = String(Date.now()).slice(-9)
    const projectName = `QATT5 Access ${stamp}`

    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')

    let project: TestTimeProjectFixture | null = null
    let leaderProfileCreated = false
    let leaderStaffMemberId: string | null = null
    let memberContext: BrowserContext | null = null

    try {
      const employeeMember = await readSelfStaffMember(request, employeeToken)
      expect(employeeMember, 'The Team Member persona must have a staff member profile').toBeTruthy()

      const leader = await ensureSelfStaffMember(request, adminToken, `QATT5 Team Leader ${stamp}`)
      leaderProfileCreated = leader.created
      leaderStaffMemberId = leader.member.id

      project = await createTestTimeProject(request, adminToken, {
        name: projectName,
        code: `QT5A-${stamp}`,
      })

      const browser = page.context().browser()
      expect(browser, 'A browser instance is required for the second (Team Member) session').toBeTruthy()
      memberContext = await browser!.newContext({ baseURL: process.env.BASE_URL || 'http://localhost:3000' })
      const memberPage = await memberContext.newPage()

      // The Team Member signs in BEFORE the assignment exists. That session is never
      // renewed, so anything it can reach afterwards was granted without a re-login.
      await login(memberPage, 'employee')
      expect(
        await timesheetOffersProject(memberPage, projectName),
        'Before assignment the Team Member must not see the project',
      ).toBe(false)

      await login(page, 'admin')
      await page.goto(TEAM_DRAWER_PAGE(project.id))

      const teamDrawer = page.getByRole('dialog', { name: 'Project team' })
      await expect(teamDrawer).toBeVisible({ timeout: 30_000 })
      await expect(teamDrawer).toContainText(projectName)

      // Screen 5 note 2 — the leader's own row is checked, disabled and badged.
      const leaderRow = teamDrawer.locator(`[data-staff-member-id="${leaderStaffMemberId}"]`)
      await expect(leaderRow).toBeVisible()
      await expect(leaderRow.getByRole('checkbox')).toBeDisabled()
      await expect(leaderRow.getByRole('checkbox')).toBeChecked()
      await expect(leaderRow).toContainText('always')
      await expect(leaderRow).toContainText('access from role')

      // Screen 5 — multi-select from "Everyone else in the organization".
      await teamDrawer.getByPlaceholder('Search for a person…').fill(employeeMember!.displayName)
      const memberRow = teamDrawer.locator(`[data-staff-member-id="${employeeMember!.id}"]`)
      await expect(memberRow).toBeVisible({ timeout: 30_000 })
      await memberRow.getByRole('checkbox').check()
      await expect(memberRow).toContainText('being added')

      // The drawer states the two promises the mockup makes about access.
      await expect(teamDrawer).toContainText('Access works immediately after saving — no re-login needed.')
      await expect(teamDrawer).toContainText(
        'Revoking access does not delete logged time — the entries stay in the project and in reports.',
      )

      await expect(teamDrawer).toContainText('1 change to save')
      await teamDrawer.getByRole('button', { name: 'Save', exact: true }).click()

      await expect(page.getByText('Project team updated.')).toBeVisible({ timeout: 30_000 })
      await expect(teamDrawer).toHaveCount(0)

      // US-B2 — same browser session, no new login, project now reachable.
      expect(
        await timesheetOffersProject(memberPage, projectName),
        'After assignment the same Team Member session must reach the project without logging in again',
      ).toBe(true)
    } finally {
      if (memberContext) await memberContext.close().catch(() => {})
      if (project) await project.cleanup()
      if (leaderProfileCreated && leaderStaffMemberId) {
        await deleteStaffEntityIfExists(request, adminToken, '/api/staff/team-members', leaderStaffMemberId)
      }
    }
  })

  test('confirms before revoking access from a member with logged hours and keeps their entries', async ({ page, request }) => {
    test.setTimeout(180_000)

    const stamp = String(Date.now()).slice(-9)
    const projectName = `QATT5 Revoke ${stamp}`
    const entryDate = new Date().toISOString().slice(0, 10)

    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')

    let project: TestTimeProjectFixture | null = null
    let entryId: string | null = null

    try {
      const employeeMember = await readSelfStaffMember(request, employeeToken)
      expect(employeeMember, 'The Team Member persona must have a staff member profile').toBeTruthy()

      project = await createTestTimeProject(request, adminToken, {
        name: projectName,
        code: `QT5R-${stamp}`,
      })
      await assignEmployeeToProjectFixture(request, adminToken, project.id, employeeMember!.id)

      // 150 minutes renders as the clock value 2:30 everywhere in the drawer.
      entryId = await createTimeEntryFixture(request, employeeToken, {
        staffMemberId: employeeMember!.id,
        timeProjectId: project.id,
        date: entryDate,
        durationMinutes: 150,
      })

      await login(page, 'admin')
      await page.goto(TEAM_DRAWER_PAGE(project.id))
      const teamDrawer = page.getByRole('dialog', { name: 'Project team' })
      await expect(teamDrawer).toBeVisible({ timeout: 30_000 })

      const memberRow = teamDrawer.locator(`[data-staff-member-id="${employeeMember!.id}"]`)
      await expect(memberRow).toBeVisible({ timeout: 30_000 })
      await expect(memberRow).toContainText('2:30 in this project', { timeout: 30_000 })

      // Screen 5 note 3 — the confirmation names the person and the hours at stake.
      await memberRow.getByRole('checkbox').uncheck()
      const confirmDialog = page.getByRole('alertdialog', { name: /revoke access\?/i })
      await expect(confirmDialog).toBeVisible()
      await expect(confirmDialog).toContainText(`${employeeMember!.displayName} has 2:30 in this project`)
      await confirmDialog.getByRole('button', { name: /^confirm$/i }).click()

      await expect(memberRow).toContainText('being removed')
      await teamDrawer.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByText('Project team updated.')).toBeVisible({ timeout: 30_000 })

      // The membership is gone…
      const membersResponse = await apiRequest(
        request,
        'GET',
        `${EMPLOYEES_PATH(project.id)}?page=1&pageSize=100`,
        { token: adminToken },
      )
      expect(membersResponse.ok(), `GET project employees should succeed: ${membersResponse.status()}`).toBeTruthy()
      const membersBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(membersResponse)
      const stillAssigned = (membersBody?.items ?? []).some(
        (item) => String(item.staff_member_id ?? item.staffMemberId ?? '') === employeeMember!.id,
      )
      expect(stillAssigned, 'Saving the drawer should remove the membership').toBe(false)

      // …but US-B2 says access is not data ownership: the logged time survives.
      const entriesResponse = await apiRequest(
        request,
        'GET',
        `${TIME_ENTRIES_PATH}?projectId=${encodeURIComponent(project.id)}&pageSize=100`,
        { token: adminToken },
      )
      expect(entriesResponse.ok(), `GET time entries should succeed: ${entriesResponse.status()}`).toBeTruthy()
      const entriesBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(entriesResponse)
      const survivingEntry = (entriesBody?.items ?? []).find((item) => String(item.id ?? '') === entryId)
      expect(survivingEntry, 'Revoking access must not delete the member’s time entries').toBeTruthy()
      expect(Number(survivingEntry!.duration_minutes)).toBe(150)
    } finally {
      if (entryId) await deleteStaffEntityIfExists(request, employeeToken, TIME_ENTRIES_PATH, entryId)
      if (project) await project.cleanup()
    }
  })

  test('marks an assignment whose end date plus grace has passed as expired (D-12)', async ({ page, request }) => {
    test.setTimeout(120_000)

    const stamp = String(Date.now()).slice(-9)
    const projectName = `QATT5 Expired ${stamp}`
    // Far past any plausible `access.assignmentGraceDays` (default 14).
    const assignedStartDate = isoDaysAgo(500)
    const assignedEndDate = isoDaysAgo(400)

    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')

    let project: TestTimeProjectFixture | null = null
    let membershipId: string | null = null

    try {
      const employeeMember = await readSelfStaffMember(request, employeeToken)
      expect(employeeMember, 'The Team Member persona must have a staff member profile').toBeTruthy()

      project = await createTestTimeProject(request, adminToken, {
        name: projectName,
        code: `QT5E-${stamp}`,
      })

      // `assignEmployeeToProjectFixture` cannot express an end date, and widening the
      // shared fixture for one spec would change every caller's signature, so the
      // expired membership is posted directly.
      const assignResponse = await apiRequest(request, 'POST', EMPLOYEES_PATH(project.id), {
        token: adminToken,
        data: {
          staffMemberId: employeeMember!.id,
          status: 'active',
          assignedStartDate,
          assignedEndDate,
        },
      })
      expect(assignResponse.ok(), `Assigning an expired membership should succeed: ${assignResponse.status()}`).toBeTruthy()
      const assignBody = await readJsonSafe<{ id?: string }>(assignResponse)
      membershipId = typeof assignBody?.id === 'string' ? assignBody.id : null

      await login(page, 'admin')
      await page.goto(TEAM_DRAWER_PAGE(project.id))
      const teamDrawer = page.getByRole('dialog', { name: 'Project team' })
      await expect(teamDrawer).toBeVisible({ timeout: 30_000 })

      const memberRow = teamDrawer.locator(`[data-staff-member-id="${employeeMember!.id}"]`)
      await expect(memberRow).toBeVisible({ timeout: 30_000 })
      await expect(memberRow).toContainText(`expired ${assignedEndDate}`)
      await expect(memberRow).toContainText('The assignment expired — this person no longer has access to the project.')
    } finally {
      if (membershipId && project) {
        await deleteStaffEntityIfExists(request, adminToken, EMPLOYEES_PATH(project.id), membershipId)
      }
      if (project) await project.cleanup()
    }
  })
})
