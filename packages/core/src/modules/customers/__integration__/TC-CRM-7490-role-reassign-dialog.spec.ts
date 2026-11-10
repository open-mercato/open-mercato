/**
 * TC-CRM-7490: One modal flow for role assignment and reassignment
 * Source: 2026-04-06-crm-detail-pages-ux-enhancements — Enhancement 3, Rev 7 (#7490)
 *
 * Verifies on a company-v2 People tab:
 * - "Choose person" on an empty role card opens the shared dialog with the role preselected
 *   and creates the assignment (POST)
 * - "Change user" on the assigned card opens the same dialog as "Change assignee" with the
 *   incumbent preselected; saving a different member updates the SAME assignment (PUT)
 * - Escape on the reassign dialog writes nothing
 * - the generic shortcut reads "Assign role" and disappears once every role type is assigned
 *
 * Fixtures: one company, one role type (dictionary entry) and two staff members backed by the
 * admin and employee users; everything is removed in `finally`.
 */
import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

function decodeJwtSub(token: string): string {
  const [, payload = ''] = token.split('.')
  const decoded = Buffer.from(payload, 'base64url').toString('utf8')
  const parsed = JSON.parse(decoded) as { sub?: string }
  if (typeof parsed.sub !== 'string' || parsed.sub.length === 0) {
    throw new Error('JWT subject is missing')
  }
  return parsed.sub
}

type RoleItem = { id: string; roleType: string; userId: string; userName?: string | null; userEmail?: string | null }

function assigneeLabel(item: RoleItem | undefined): string {
  return item?.userName ?? item?.userEmail ?? item?.userId ?? ''
}

test.describe('TC-CRM-7490: role assignment and reassignment share one dialog', () => {
  test('assigns, reassigns through the same dialog and hides the shortcut when nothing is free', async ({ page, request }) => {
    test.slow()

    const stamp = Date.now()
    const roleValue = `qa_role_${stamp}`
    const roleLabel = `QA Role ${stamp}`
    const firstMemberName = `QA Member A ${stamp}`
    const secondMemberName = `QA Member B ${stamp}`

    let adminToken: string | null = null
    let companyId: string | null = null
    let roleTypeId: string | null = null
    const memberIds: string[] = []

    try {
      adminToken = await getAuthToken(request, 'admin')
      const employeeToken = await getAuthToken(request, 'employee')
      const adminUserId = decodeJwtSub(adminToken)
      const employeeUserId = decodeJwtSub(employeeToken)

      // Role type fixture — the only role type this test relies on. Existing tenant role
      // types may also be present; the assertions scope to this one by label.
      const roleTypeResponse = await apiRequest(request, 'POST', '/api/customers/dictionaries/person-company-roles', {
        token: adminToken,
        data: { value: roleValue, label: roleLabel },
      })
      expect(roleTypeResponse.status(), await roleTypeResponse.text()).toBe(201)
      roleTypeId = ((await roleTypeResponse.json()) as { id: string }).id

      for (const [displayName, userId] of [[firstMemberName, adminUserId], [secondMemberName, employeeUserId]] as const) {
        const memberResponse = await apiRequest(request, 'POST', '/api/staff/team-members', {
          token: adminToken,
          data: { displayName, userId, isActive: true },
        })
        expect(memberResponse.ok(), `team member fixture should be created: ${memberResponse.status()}`).toBeTruthy()
        const memberId = ((await memberResponse.json()) as { id?: string }).id
        if (typeof memberId === 'string') memberIds.push(memberId)
      }

      companyId = await createCompanyFixture(request, adminToken, `QA Reassign ${stamp}`)
      await login(page, 'admin')
      await page.goto(`/backend/customers/companies-v2/${companyId}?tab=people`, { waitUntil: 'domcontentloaded' })

      const roleCard = page.locator('div', { hasText: roleLabel }).filter({ has: page.getByRole('button', { name: /^Choose person$/ }) }).last()
      await expect(roleCard, 'the new role type renders as an empty card').toBeVisible({ timeout: 30_000 })

      // --- Step 1: assign through the dialog (POST) ---
      await roleCard.getByRole('button', { name: /^Choose person$/ }).click()
      const dialog = page.getByRole('dialog', { name: /^Assign role$/ })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText(roleLabel).first(), 'the card shortcut preselects its role').toBeVisible()
      await dialog.getByPlaceholder(/Search by name, e-mail or team/i).fill(firstMemberName)
      await dialog.getByRole('button', { name: new RegExp(firstMemberName) }).click()
      await dialog.getByRole('button', { name: 'Next' }).click()
      await dialog.getByRole('button', { name: 'Assign role' }).click()
      await expect(dialog).toBeHidden({ timeout: 15_000 })

      const assignedCard = page.locator('div', { hasText: roleLabel }).filter({ has: page.getByRole('button', { name: /^Change user$/ }) }).last()

      const listAfterAssign = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}/roles`, { token: adminToken })
      const assignedItems = ((await listAfterAssign.json()) as { items?: RoleItem[] }).items ?? []
      const assignment = assignedItems.find((item) => item.roleType === roleValue)
      expect(assignment, 'the assignment exists for the fixture role').toBeTruthy()
      expect(assignment?.userId).toBe(adminUserId)
      // The card names the assigned user account, not the team member picked in the dialog.
      const firstAssignee = assigneeLabel(assignment)
      await expect(assignedCard.getByText(firstAssignee).first()).toBeVisible({ timeout: 15_000 })

      // --- Step 2: Escape on the reassign dialog writes nothing ---
      await assignedCard.getByRole('button', { name: /^Change user$/ }).click()
      const reassignDialog = page.getByRole('dialog', { name: /^Change assignee$/ })
      await expect(reassignDialog, 'Change user opens the shared dialog in reassign mode').toBeVisible()
      await expect(reassignDialog.getByText(`Currently: ${firstAssignee}`)).toBeVisible()
      await expect(reassignDialog.getByRole('button', { name: /^Change$/ }), 'the role stays fixed').toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(reassignDialog).toBeHidden()
      const listAfterEscape = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}/roles`, { token: adminToken })
      const escapedItems = ((await listAfterEscape.json()) as { items?: Array<{ id: string; roleType: string; userId: string }> }).items ?? []
      expect(escapedItems.find((item) => item.roleType === roleValue)?.userId, 'Escape must not write').toBe(adminUserId)

      // --- Step 3: reassign to the second member (PUT keeps the assignment id) ---
      await assignedCard.getByRole('button', { name: /^Change user$/ }).click()
      await expect(reassignDialog).toBeVisible()
      await reassignDialog.getByPlaceholder(/Search by name, e-mail or team/i).fill(secondMemberName)
      await reassignDialog.getByRole('button', { name: new RegExp(secondMemberName) }).click()
      await reassignDialog.getByRole('button', { name: 'Next' }).click()
      await reassignDialog.getByRole('button', { name: 'Save change' }).click()
      await expect(reassignDialog).toBeHidden({ timeout: 15_000 })

      const listAfterReassign = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}/roles`, { token: adminToken })
      const reassignedItems = ((await listAfterReassign.json()) as { items?: RoleItem[] }).items ?? []
      const reassigned = reassignedItems.find((item) => item.roleType === roleValue)
      expect(reassigned?.id, 'reassignment keeps the assignment identity').toBe(assignment?.id)
      expect(reassigned?.userId).toBe(employeeUserId)
      await expect(assignedCard.getByText(assigneeLabel(reassigned)).first()).toBeVisible({ timeout: 15_000 })

      // --- Step 4: the generic shortcut says "Assign role" and goes away once nothing is free ---
      const shortcut = page.getByRole('button', { name: /^Assign role$/ })
      await expect(page.getByRole('button', { name: /^Add role$/ })).toHaveCount(0)
      const emptyCards = await page.getByRole('button', { name: /^Choose person$/ }).count()
      if (emptyCards === 0) {
        await expect(shortcut, 'no free role type left: the shortcut is not rendered').toHaveCount(0)
      } else {
        await expect(shortcut).toBeVisible()
      }
    } finally {
      if (adminToken && companyId) {
        const rolesResponse = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}/roles`, { token: adminToken }).catch(() => null)
        const items = rolesResponse && rolesResponse.ok()
          ? (((await rolesResponse.json()) as { items?: Array<{ id: string }> }).items ?? [])
          : []
        for (const item of items) {
          await apiRequest(request, 'DELETE', `/api/customers/companies/${companyId}/roles?roleId=${item.id}`, { token: adminToken }).catch(() => {})
        }
      }
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
      for (const memberId of memberIds) {
        await apiRequest(request, 'DELETE', `/api/staff/team-members?id=${encodeURIComponent(memberId)}`, { token: adminToken ?? '' }).catch(() => {})
      }
      if (adminToken && roleTypeId) {
        await apiRequest(request, 'DELETE', `/api/customers/dictionaries/person-company-roles/${encodeURIComponent(roleTypeId)}`, { token: adminToken }).catch(() => {})
      }
    }
  })
})
