/**
 * TC-CRM-7491: Holding another role is advisory in the assign-role dialog
 *
 * A team member who already holds a role on a company can take a second one, so the dialog
 * labels them instead of warning about a conflict. Verifies:
 * - the candidate row shows `Already assigned: <role>` and no `Conflict` text
 * - selecting that candidate shows the several-roles hint and keeps Next enabled
 * - the second assignment persists, so the roles API lists both roles for the user
 * - a filled role type is not offered again, and a duplicate same-role POST returns 409
 * - at 390px the combined badge of a two-role candidate stays inside the candidate row
 *
 * Fixtures: three role types, a user with a team member, a company and a linked person, all
 * created through the API and removed in `finally`. The Roles header only renders once the
 * company has people, which is why the person is linked.
 */
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteStaffEntityIfExists } from '@open-mercato/core/helpers/integration/staffFixtures'

export const integrationMeta = { dependsOnModules: ['customers', 'staff'] }

const ROLE_TYPES_PATH = '/api/customers/dictionaries/person-company-roles'
const TEAM_MEMBERS_PATH = '/api/staff/team-members'
const SEVERAL_ROLES_HINT = 'One person can hold several roles on this record.'

type RoleType = { id: string; value: string; label: string }

type RoleTypes = { budgetHolder: RoleType; decisionMaker: RoleType; endUser: RoleType }

type CreatedFixtures = {
  roleTypeIds: string[]
  userId: string | null
  teamMemberId: string | null
  companyId: string | null
  personId: string | null
}

type Box = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>

function emptyFixtures(): CreatedFixtures {
  return { roleTypeIds: [], userId: null, teamMemberId: null, companyId: null, personId: null }
}

function companyRolesPath(companyId: string): string {
  return `/api/customers/companies/${encodeURIComponent(companyId)}/roles`
}

async function createRoleType(
  request: APIRequestContext,
  token: string,
  created: CreatedFixtures,
  value: string,
  label: string,
): Promise<RoleType> {
  const response = await apiRequest(request, 'POST', ROLE_TYPES_PATH, { token, data: { value, label } })
  expect(response.status(), `POST ${ROLE_TYPES_PATH} should return 201`).toBe(201)
  const body = await readJsonSafe<{ id?: string; value?: string; label?: string }>(response)
  const id = expectId(body?.id, 'Role type creation response should include id')
  created.roleTypeIds.push(id)
  return { id, value: body?.value ?? value, label: body?.label ?? label }
}

async function createRoleTypes(
  request: APIRequestContext,
  token: string,
  created: CreatedFixtures,
  stamp: number,
): Promise<RoleTypes> {
  return {
    budgetHolder: await createRoleType(request, token, created, `qa_7491_budget_holder_${stamp}`, `QA Budget holder ${stamp}`),
    decisionMaker: await createRoleType(request, token, created, `qa_7491_decision_maker_${stamp}`, `QA Decision maker ${stamp}`),
    endUser: await createRoleType(request, token, created, `qa_7491_end_user_${stamp}`, `QA End user ${stamp}`),
  }
}

async function createAssignableTeamMember(
  request: APIRequestContext,
  token: string,
  created: CreatedFixtures,
  displayName: string,
  stamp: number,
): Promise<string> {
  const { organizationId } = getTokenContext(token)
  const userId = await createUserFixture(request, token, {
    email: `qa-tc-crm-7491-${stamp}@example.com`,
    password: 'Valid1!Pass',
    organizationId,
    roles: ['employee'],
    name: displayName,
  })
  created.userId = userId
  const response = await apiRequest(request, 'POST', TEAM_MEMBERS_PATH, {
    token,
    data: { displayName, userId },
  })
  expect(response.status(), `POST ${TEAM_MEMBERS_PATH} should return 201`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  created.teamMemberId = expectId(body?.id, 'Team member creation response should include id')
  return userId
}

async function createCompanyWithPerson(
  request: APIRequestContext,
  token: string,
  created: CreatedFixtures,
  stamp: number,
): Promise<string> {
  const companyId = await createCompanyFixture(request, token, `QA TC-CRM-7491 Co ${stamp}`)
  created.companyId = companyId
  created.personId = await createPersonFixture(request, token, {
    firstName: 'QA',
    lastName: `TC7491-${stamp}`,
    displayName: `QA TC-CRM-7491 Person ${stamp}`,
    companyEntityId: companyId,
  })
  return companyId
}

async function assignRoleThroughApi(
  request: APIRequestContext,
  token: string,
  companyId: string,
  roleType: RoleType,
  userId: string,
): Promise<void> {
  const response = await apiRequest(request, 'POST', companyRolesPath(companyId), {
    token,
    data: { roleType: roleType.value, userId },
  })
  expect(response.status(), `Assigning ${roleType.value} through the API should return 201`).toBe(201)
}

async function readRoleAssignments(
  request: APIRequestContext,
  token: string,
  companyId: string,
): Promise<Array<{ id: string; roleType: string; userId: string }>> {
  const response = await apiRequest(request, 'GET', companyRolesPath(companyId), { token })
  expect(response.ok(), `GET roles should succeed: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ items?: Array<{ id: string; roleType: string; userId: string }> }>(response)
  return body?.items ?? []
}

async function deleteFixtures(
  request: APIRequestContext,
  token: string,
  created: CreatedFixtures,
): Promise<void> {
  if (created.companyId) {
    const rolesPath = companyRolesPath(created.companyId)
    const assignments = await readRoleAssignments(request, token, created.companyId).catch(() => [])
    for (const assignment of assignments) {
      await apiRequest(request, 'DELETE', `${rolesPath}?roleId=${encodeURIComponent(assignment.id)}`, { token }).catch(() => undefined)
    }
  }
  await deleteStaffEntityIfExists(request, token, TEAM_MEMBERS_PATH, created.teamMemberId)
  await deleteEntityIfExists(request, token, '/api/customers/people', created.personId)
  await deleteEntityIfExists(request, token, '/api/customers/companies', created.companyId)
  await deleteUserIfExists(request, token, created.userId)
  for (const roleTypeId of created.roleTypeIds) {
    await apiRequest(request, 'DELETE', `${ROLE_TYPES_PATH}/${encodeURIComponent(roleTypeId)}`, { token }).catch(() => undefined)
  }
}

function assignRoleDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Assign role', exact: true })
}

function roleTypeSelect(dialog: Locator): Locator {
  return dialog.getByRole('combobox', { name: 'Role type', exact: true })
}

function nextButton(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: 'Next', exact: true })
}

async function openAddRoleDialog(page: Page): Promise<Locator> {
  // #7490 renames this button to Assign role; the spec has to hold before and after it lands.
  await page.getByRole('button', { name: /^(Add role|Assign role)$/ }).click()
  const dialog = assignRoleDialog(page)
  await expect(dialog).toBeVisible()
  return dialog
}

async function findCandidateRow(dialog: Locator, roleType: RoleType, memberName: string): Promise<Locator> {
  const select = roleTypeSelect(dialog)
  await select.selectOption({ value: roleType.value })
  await expect(select).toHaveValue(roleType.value)
  await nextButton(dialog).click()

  const search = dialog.getByPlaceholder('Search by name, e-mail or team...')
  await search.fill(memberName)
  await expect(search).toHaveValue(memberName)
  await expect(dialog.getByText('Showing 1 of 1 team members', { exact: true })).toBeVisible()

  const row = dialog.getByRole('button').filter({ hasText: memberName })
  await expect(row).toBeVisible()
  return row
}

async function readBox(locator: Locator, name: string): Promise<Box> {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  if (!box) throw new Error(`[internal] ${name} has no bounding box`)
  return box
}

test.describe('TC-CRM-7491: Role overlap is advisory in the assign-role dialog', () => {
  test('a second role can be assigned to someone who already holds one, and a filled role stays refused', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const memberName = `QA 7491 Member ${stamp}`
    const created = emptyFixtures()

    try {
      const { budgetHolder, decisionMaker, endUser } = await createRoleTypes(request, token, created, stamp)
      const userId = await createAssignableTeamMember(request, token, created, memberName, stamp)
      const companyId = await createCompanyWithPerson(request, token, created, stamp)
      await assignRoleThroughApi(request, token, companyId, budgetHolder, userId)

      await login(page, 'admin')
      await page.setViewportSize({ width: 1600, height: 900 })
      await page.goto(`/backend/customers/companies-v2/${companyId}`, { waitUntil: 'domcontentloaded' })

      const dialog = await openAddRoleDialog(page)
      const row = await findCandidateRow(dialog, decisionMaker, memberName)

      await expect(row.getByText(`Already assigned: ${budgetHolder.label}`, { exact: true })).toBeVisible()
      await expect(dialog.getByText(/conflict/i)).toHaveCount(0)
      await expect(nextButton(dialog)).toBeDisabled()

      await row.click()
      await expect(dialog.getByText(SEVERAL_ROLES_HINT, { exact: true })).toBeVisible()
      await expect(dialog.getByText(/conflict/i)).toHaveCount(0)
      await expect(nextButton(dialog)).toBeEnabled()

      await nextButton(dialog).click()
      await dialog.getByRole('button', { name: 'Assign role', exact: true }).click()
      await expect(dialog).toBeHidden()

      const assignedAfterDialog = await readRoleAssignments(request, token, companyId)
      expect(
        assignedAfterDialog
          .filter((assignment) => assignment.userId === userId)
          .map((assignment) => assignment.roleType)
          .sort(),
      ).toEqual([budgetHolder.value, decisionMaker.value].sort())

      const reopenedDialog = await openAddRoleDialog(page)
      const reopenedSelect = roleTypeSelect(reopenedDialog)
      await expect(reopenedSelect.locator(`option[value="${endUser.value}"]`)).toHaveCount(1)
      await expect(reopenedSelect.locator(`option[value="${budgetHolder.value}"]`)).toHaveCount(0)
      await expect(reopenedSelect.locator(`option[value="${decisionMaker.value}"]`)).toHaveCount(0)
      await reopenedDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(reopenedDialog).toBeHidden()

      const duplicate = await apiRequest(request, 'POST', companyRolesPath(companyId), {
        token,
        data: { roleType: budgetHolder.value, userId },
      })
      expect(duplicate.status(), 'A duplicate same-role assignment should return 409').toBe(409)
    } finally {
      await deleteFixtures(request, token, created)
    }
  })

  test('at 390px the combined badge of a two-role candidate stays inside the candidate row', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const memberName = `QA 7491 Member ${stamp}`
    const created = emptyFixtures()

    try {
      const { budgetHolder, decisionMaker, endUser } = await createRoleTypes(request, token, created, stamp)
      const userId = await createAssignableTeamMember(request, token, created, memberName, stamp)
      const companyId = await createCompanyWithPerson(request, token, created, stamp)
      await assignRoleThroughApi(request, token, companyId, budgetHolder, userId)
      await assignRoleThroughApi(request, token, companyId, decisionMaker, userId)

      await login(page, 'admin')
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`/backend/customers/companies-v2/${companyId}`, { waitUntil: 'domcontentloaded' })

      const dialog = await openAddRoleDialog(page)
      const row = await findCandidateRow(dialog, endUser, memberName)
      const badge = row.getByText(`Already assigned: ${budgetHolder.label}, ${decisionMaker.label}`, { exact: true })

      const badgeBox = await readBox(badge, 'Combined badge')
      const rowBox = await readBox(row, 'Candidate row')
      const dialogBox = await readBox(dialog, 'Assign role dialog')

      expect(badgeBox.x, 'Badge left edge stays inside the row').toBeGreaterThanOrEqual(rowBox.x)
      expect(badgeBox.x + badgeBox.width, 'Badge right edge stays inside the row').toBeLessThanOrEqual(rowBox.x + rowBox.width)
      expect(badgeBox.y, 'Badge top edge stays inside the row').toBeGreaterThanOrEqual(rowBox.y)
      expect(badgeBox.y + badgeBox.height, 'Badge bottom edge stays inside the row').toBeLessThanOrEqual(rowBox.y + rowBox.height)
      expect(rowBox.x, 'Row left edge stays inside the dialog').toBeGreaterThanOrEqual(dialogBox.x)
      expect(rowBox.x + rowBox.width, 'Row right edge stays inside the dialog').toBeLessThanOrEqual(dialogBox.x + dialogBox.width)
    } finally {
      await deleteFixtures(request, token, created)
    }
  })
})
