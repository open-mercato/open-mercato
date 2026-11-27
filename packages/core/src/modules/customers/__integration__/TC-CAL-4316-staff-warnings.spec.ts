import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteStaffEntityIfExists } from '@open-mercato/core/helpers/integration/staffFixtures'
import { createInteractionFixture, gridBlockName, INTERACTIONS_PATH, waitForCalendarLoaded } from './helpers/calendarFixtures'

export const integrationMeta = { dependsOnModules: ['customers', 'staff', 'planner'] }

test.use({ timezoneId: 'UTC' })

const membersPath = '/api/staff/team-members'
const leavePath = '/api/staff/leave-requests'
const windowsPath = '/api/staff/availability/windows'

async function openEditor(page: Page, title: string) {
  const editor = page.getByRole('dialog')
  await expect(async () => {
    await page.getByRole('button', { name: gridBlockName(title) }).click({ timeout: 5_000 })
    await page.getByRole('button', { name: 'Edit', exact: true }).click({ timeout: 3_000 })
    await expect(editor.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title, { timeout: 3_000 })
  }).toPass({ timeout: 18_000 })
  return editor
}

test('TC-CAL-4316: Staff leave warnings are advisory and a missing Staff route preserves Calendar conflicts', async ({ page, request }) => {
  test.slow()
  const token = await getAuthToken(request, 'admin')
  const { organizationId, userId: viewerId } = getTokenScope(token)
  const stamp = randomUUID().slice(0, 8)
  const staffName = `QA Calendar Staff ${stamp}`
  const title = `QA Calendar leave ${stamp}`
  const overlapTitle = `QA Calendar overlap ${stamp}`
  const pendingLeave = /pending leave request/i
  const now = new Date()
  const wednesday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2 - (now.getUTCDay() + 6) % 7, 14))
  const leaveDay = wednesday.toISOString().slice(0, 10)

  await withCredentialIsolatedRequest(async (provisionRequest) => {
    const root = await getAuthToken(provisionRequest, 'superadmin')
    let staffUserId: string | null = null
    let memberId: string | null = null
    let leaveId: string | null = null
    let personId: string | null = null
    const meetingIds: string[] = []
    try {
      staffUserId = await createUserFixture(provisionRequest, root, {
        email: `calendar-leave-${stamp}@example.com`, password: `Qa-${stamp}Mix!987`, name: staffName, organizationId, roles: [],
      })
      const member = await apiRequest(request, 'POST', membersPath, { token, data: { userId: staffUserId, displayName: staffName } })
      expect(member.status()).toBe(201)
      memberId = expectId((await readJsonSafe<{ id?: string }>(member))?.id, 'A linked team member is created')
      const leave = await apiRequest(request, 'POST', leavePath, {
        token, data: { memberId, startDate: leaveDay, endDate: leaveDay, timezone: 'UTC' },
      })
      expect(leave.status()).toBe(201)
      leaveId = expectId((await readJsonSafe<{ id?: string }>(leave))?.id, 'A pending leave request is created')
      personId = await createPersonFixture(request, token, { firstName: 'Calendar', lastName: stamp, displayName: `QA Calendar person ${stamp}` })
      meetingIds.push(await createInteractionFixture(request, token, {
        entityId: personId, interactionType: 'meeting', title, scheduledAt: wednesday, durationMinutes: 60,
        ownerUserId: viewerId, participants: [{ userId: staffUserId, name: staffName }],
      }))
      meetingIds.push(await createInteractionFixture(request, token, {
        entityId: personId, interactionType: 'meeting', title: overlapTitle,
        scheduledAt: new Date(wednesday.getTime() + 30 * 60_000), durationMinutes: 60, ownerUserId: viewerId,
      }))

      await login(page, 'admin')
      await page.goto('/backend/calendar')
      await waitForCalendarLoaded(page)
      const eventButton = page.getByRole('button', { name: gridBlockName(title) })
      await expect(eventButton).toHaveAttribute('aria-description', pendingLeave)

      const editor = await openEditor(page, title)
      const alert = editor.getByRole('alert').filter({ hasText: 'Calendar conflict' })
      await expect(alert).toContainText(pendingLeave)
      await expect(alert).toContainText(overlapTitle)
      const editedTitle = `${title} saved`
      await editor.getByRole('textbox', { name: 'Title', exact: true }).fill(editedTitle)
      const [saved] = await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === INTERACTIONS_PATH && response.request().method() === 'PUT'),
        editor.getByRole('button', { name: 'Save event', exact: true }).click(),
      ])
      expect(saved.ok()).toBe(true)
      await expect(editor).toBeHidden()
      await expect(page.getByRole('button', { name: gridBlockName(editedTitle) })).toBeVisible()

      await page.route(/\/api\/staff\/availability\/windows(?:\?|$)/, (route) => route.fulfill({ status: 404, json: {} }))
      const missingWindows = page.waitForResponse((response) => new URL(response.url()).pathname === windowsPath && response.status() === 404)
      await page.reload()
      await missingWindows
      await waitForCalendarLoaded(page)
      await expect(page.getByRole('button', { name: gridBlockName(editedTitle) })).not.toHaveAttribute('aria-description', pendingLeave)
      const fallbackEditor = await openEditor(page, editedTitle)
      const fallbackAlert = fallbackEditor.getByRole('alert').filter({ hasText: 'Calendar conflict' })
      await expect(fallbackAlert).toContainText(overlapTitle)
      await expect(fallbackAlert).not.toContainText(pendingLeave)
      await expect(fallbackEditor.getByRole('button', { name: 'Save event', exact: true })).toBeEnabled()
    } finally {
      for (const meetingId of meetingIds) await deleteEntityIfExists(request, token, INTERACTIONS_PATH, meetingId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteStaffEntityIfExists(request, token, leavePath, leaveId)
      await deleteStaffEntityIfExists(request, token, membersPath, memberId)
      await deleteUserIfExists(provisionRequest, root, staffUserId)
    }
  })
})
