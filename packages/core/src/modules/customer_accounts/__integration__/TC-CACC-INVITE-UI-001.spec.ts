import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { createCustomerRoleFixture, deleteCustomerRoleFixture, uniqueSuffix } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

async function openInvitationForm(page: Page) {
  const expandPanel = page.getByRole('button', { name: 'Expand form panel', exact: true })
  const accountGroup = page.getByRole('button', { name: 'Account status', exact: true })
  await expect(expandPanel.or(accountGroup).first()).toBeVisible()
  if (await expandPanel.isVisible()) await expandPanel.click()
  await expect(accountGroup).toBeVisible()
  if (await accountGroup.getAttribute('aria-expanded') === 'false') await accountGroup.click()
  const inviteButton = page.getByRole('button', { name: 'Invite to Portal', exact: true })
  await expect(inviteButton).toBeVisible()
  await inviteButton.click()
}

test.describe('TC-CACC-INVITE-UI-001: invitation role choices and mobile containment', () => {
  test('offers only customer-assignable roles and contains a long role on a phone', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const suffix = uniqueSuffix()
    const personName = `QA ${suffix}`
    const allowedName = `QA Buyer ${suffix}`
    const longName = `QA Long ${suffix} ${'LongRoleNameWithoutSpaces'.repeat(9)}`
    const restrictedName = `QA Restricted ${suffix}`
    const roleIds: string[] = []
    let personId: string | null = null

    try {
      const allowedRole = await createCustomerRoleFixture(request, token, { name: allowedName, customerAssignable: true })
      roleIds.push(allowedRole.id)
      roleIds.push((await createCustomerRoleFixture(request, token, { name: longName, customerAssignable: true })).id)
      const restrictedRole = await createCustomerRoleFixture(request, token, { name: restrictedName, customerAssignable: false })
      roleIds.push(restrictedRole.id)
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: suffix,
        displayName: personName,
        primaryEmail: `qa-invite-ui-${suffix}@test.local`,
      })

      await page.setViewportSize({ width: 1440, height: 1000 })
      await login(page, 'admin')
      await page.context().addCookies([{ name: 'locale', value: 'en', url: process.env.BASE_URL || 'http://localhost:3000' }])
      await page.goto(`/backend/customers/people-v2/${personId}`)
      await expect(page.getByRole('heading', { name: personName, exact: true })).toBeVisible()
      await openInvitationForm(page)
      await expect(page.getByRole('button', { name: allowedName, exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: longName, exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: restrictedName, exact: true })).toHaveCount(0)

      const rejectedEmail = `qa-invite-ui-denied-${suffix}@test.local`
      const rejected = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users-invite', {
        token,
        data: { email: rejectedEmail, roleIds: [restrictedRole.id], personEntityId: personId },
      })
      expect(rejected.status()).toBe(400)
      const pending = await apiRequest(request, 'GET', `/api/customer_accounts/admin/users-invite?email=${encodeURIComponent(rejectedEmail)}`, { token })
      expect(pending.status()).toBe(200)
      expect((await pending.json() as { items: unknown[] }).items).toHaveLength(0)

      await page.setViewportSize({ width: 390, height: 844 })
      await openInvitationForm(page)
      const longRoleButton = page.getByRole('button', { name: longName, exact: true })
      await expect(longRoleButton).toBeVisible()
      await longRoleButton.scrollIntoViewIfNeeded()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      const bounds = await longRoleButton.boundingBox()
      expect(bounds).not.toBeNull()
      if (!bounds) throw new Error('[internal] Long role button has no bounds')
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      for (const roleId of roleIds) await deleteCustomerRoleFixture(request, token, roleId)
    }
  })
})
