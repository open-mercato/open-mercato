import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteStaffEntityIfExists } from '@open-mercato/core/helpers/integration/staffFixtures'
import {
  INTERACTIONS_PATH,
  listInteractionsInWindow,
  localTimeAt,
  waitForCalendarLoaded,
} from './helpers/calendarFixtures'

export const integrationMeta = { dependsOnModules: ['auth', 'customers', 'staff'] }

const TEAM_MEMBERS_PATH = '/api/staff/team-members'

test('TC-CAL-6683: calendar managers can select and save a staff attendee', async ({ page, request }) => {
  const adminToken = await getAuthToken(request, 'admin')
  const { organizationId, tenantId } = getTokenScope(adminToken)
  const suffix = randomUUID()
  const search = `Calendar ${suffix}`
  const customerName = `${search} Customer`
  const staffName = `${search} Staff`
  const title = `${search} Meeting`
  const email = `calendar-${suffix}@example.com`
  const password = `Qa!${randomUUID()}`
  let roleId: string | null = null
  let userId: string | null = null
  let memberId: string | null = null
  let personId: string | null = null
  let interactionId: string | null = null

  try {
    roleId = await createRoleFixture(request, adminToken, { name: search, tenantId })
    await setRoleAclFeatures(request, adminToken, {
      roleId,
      organizations: [organizationId],
      features: [
        'customers.interactions.view',
        'customers.interactions.manage',
        'customers.people.view',
        'customers.companies.view',
        'customers.deals.view',
      ],
    })
    userId = await createUserFixture(request, adminToken, {
      email,
      password,
      organizationId,
      roles: [roleId],
    })
    const member = await apiRequest(request, 'POST', TEAM_MEMBERS_PATH, {
      token: adminToken,
      data: { displayName: staffName, userId, isActive: true },
    })
    expect(member.status()).toBe(201)
    memberId = expectId((await readJsonSafe<{ id?: string }>(member))?.id, 'Staff creation should return an id')
    personId = await createPersonFixture(request, adminToken, {
      firstName: search,
      lastName: 'Customer',
      displayName: customerName,
    })

    await acknowledgeGlobalNotices(page)
    const signedIn = await page.request.post('/api/auth/login', { form: { email, password } })
    expect(signedIn.status()).toBe(200)
    await page.goto('/backend/calendar')
    await waitForCalendarLoaded(page)
    await page.getByRole('button', { name: 'New event', exact: true }).click()

    const editor = page.getByRole('dialog')
    await editor.getByRole('group', { name: 'Event type' })
      .getByRole('button', { name: 'Meeting', exact: true }).click()
    await editor.getByRole('textbox', { name: 'Title', exact: true }).fill(title)
    await editor.getByRole('button', { name: 'Related to', exact: true }).click()
    await editor.getByRole('textbox', { name: 'Search people or companies…' }).fill(customerName)
    await editor.getByRole('listbox', { name: 'Related to', exact: true })
      .getByRole('option', { name: new RegExp(suffix) }).click()

    const staffLookup = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === 'GET'
        && url.pathname === `${TEAM_MEMBERS_PATH}/assignable`
        && url.searchParams.get('search') === search
    })
    await editor.getByRole('combobox', { name: 'Attendees', exact: true }).fill(search)
    expect((await staffLookup).status(), 'Calendar managers should be able to load assignable staff').toBe(200)

    const attendees = editor.getByRole('listbox', { name: 'Attendees', exact: true })
    await expect(attendees.getByRole('option', { name: new RegExp(customerName) })).toBeVisible()
    await attendees.getByRole('option', { name: new RegExp(staffName) }).click()
    await expect(editor.getByRole('button', { name: `Remove ${staffName}`, exact: true })).toBeVisible()

    const created = page.waitForResponse((response) =>
      new URL(response.url()).pathname === INTERACTIONS_PATH && response.request().method() === 'POST',
    )
    await editor.getByRole('button', { name: 'Save event', exact: true }).click()
    const saved = await created
    expect(saved.status()).toBe(201)
    interactionId = expectId((await saved.json() as { id?: string }).id, 'Event creation should return an id')
    await expect(editor).toBeHidden()

    const items = await listInteractionsInWindow(request, adminToken, {
      entityId: personId,
      from: localTimeAt(-1, 0),
      to: localTimeAt(2, 0),
    })
    expect(items.find((item) => item.id === interactionId)?.participants).toEqual([
      expect.objectContaining({ userId, name: staffName, status: 'pending' }),
    ])
  } finally {
    await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, interactionId)
    await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
    await deleteStaffEntityIfExists(request, adminToken, TEAM_MEMBERS_PATH, memberId)
    await deleteUserIfExists(request, adminToken, userId)
    await deleteRoleIfExists(request, adminToken, roleId)
  }
})
