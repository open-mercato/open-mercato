import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createUserFixture,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCustomerRoleFixture,
  createCustomerUserFixture,
  customerTestPassword,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalLogin,
  uniqueSuffix,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { expectId, getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'

test('customer user detail shows write controls only to staff who can manage accounts', async ({ page, request, baseURL }) => {
  const appUrl = expectId(baseURL, 'Playwright should have an app URL')
  const adminToken = await getAuthToken(request, 'admin')
  const superadminToken = await getAuthToken(request, 'superadmin')
  const adminScope = getTokenScope(adminToken)
  const organizationId = expectId(adminScope.organizationId, 'fixture admin should have an organization')
  const tenantId = expectId(adminScope.tenantId, 'fixture admin should have a tenant')
  const viewerEmail = `qa-customer-viewer-${uniqueSuffix()}@test.local`
  const viewerPassword = customerTestPassword()
  const writeActions = ['Save Changes', 'Delete', 'Reset Password', 'Send Reset Link', 'Revoke']

  let viewerId: string | null = null
  let customerId: string | null = null
  let roleId: string | null = null

  try {
    viewerId = await createUserFixture(request, superadminToken, {
      email: viewerEmail,
      password: viewerPassword,
      organizationId,
      roles: [],
    })
    await setUserAclVisibility(request, superadminToken, {
      userId: viewerId,
      organizations: [organizationId],
      features: ['customer_accounts.view'],
    })
    const viewerToken = await getAuthToken(request, viewerEmail, viewerPassword)
    const role = await createCustomerRoleFixture(request, adminToken)
    roleId = role.id
    const customer = await createCustomerUserFixture(request, adminToken, { roleIds: [role.id] })
    customerId = customer.id
    await portalLogin(request, { email: customer.email, password: customer.password, tenantId })

    const detailPath = `/backend/customer_accounts/users/${customer.id}`
    const displayName = page.getByRole('textbox', { name: 'Display Name', exact: true })
    const active = page.getByRole('switch', { name: 'Active', exact: true })
    const roleButton = page.getByRole('button', { name: role.name, exact: true })

    await page.context().addCookies([{ name: 'auth_token', value: viewerToken, url: appUrl }])
    await page.goto(detailPath)
    await expect(displayName).toHaveValue(customer.displayName)
    await expect(displayName).toHaveJSProperty('readOnly', true)
    await expect(active).toBeDisabled()
    await expect(page.getByText(role.name, { exact: true })).toBeVisible()
    await expect(roleButton).toHaveCount(0)
    await expect(page.getByText('Active Sessions', { exact: false })).toBeVisible()
    for (const name of writeActions) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
    }
    await expect(page.getByPlaceholder('Search people by name...')).toHaveCount(0)
    await expect(page.getByPlaceholder('Search companies by name...')).toHaveCount(0)

    await page.context().clearCookies()
    await page.context().addCookies([{ name: 'auth_token', value: adminToken, url: appUrl }])
    await page.goto(detailPath)
    await expect(displayName).toBeEditable()
    await expect(active).toBeEnabled()
    await expect(roleButton).toBeEnabled()
    for (const name of writeActions) {
      await expect(page.getByRole('button', { name, exact: true })).toBeEnabled()
    }
  } finally {
    await deleteCustomerUserFixture(request, adminToken, customerId)
    await deleteCustomerRoleFixture(request, adminToken, roleId)
    await deleteUserIfExists(request, superadminToken, viewerId)
  }
})
