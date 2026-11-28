import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

test('TC-DIR-SCOPED-SWITCHER-001: an elevated role with a finite organization grant sees only its authorized organization', async ({ page, request }) => {
  test.slow()
  const adminToken = await getAuthToken(request, 'superadmin')
  const { tenantId } = getTokenContext(adminToken)
  const suffix = randomUUID().slice(0, 8)
  const allowedName = `QA Assigned ${suffix}`
  const outsideName = `QA Other ${suffix}`
  const email = `qa-scoped-switcher-${suffix}@example.test`
  const password = 'Scoped3!Switcher'

  let allowedId: string | null = null
  let outsideId: string | null = null
  let roleId: string | null = null
  let userId: string | null = null

  try {
    allowedId = await createOrganizationFixture(request, adminToken, { name: allowedName, tenantId })
    outsideId = await createOrganizationFixture(request, adminToken, { name: outsideName, tenantId })
    roleId = await createRoleFixture(request, adminToken, { name: `qa-scoped-switcher-${suffix}`, tenantId })

    const grant = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
      token: adminToken,
      data: {
        roleId,
        isSuperAdmin: true,
        features: ['directory.organizations.view'],
        organizations: [allowedId],
      },
    })
    expect(grant.status()).toBe(200)

    userId = await createUserFixture(request, adminToken, {
      email,
      password,
      organizationId: allowedId,
      roles: [roleId],
    })

    await acknowledgeGlobalNotices(page)
    await page.goto('/login')
    await expect(page.locator('form[data-auth-ready="1"]')).toBeVisible()
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    const switcher = page.getByRole('button', { name: `Organization: ${allowedName}`, exact: true })
    await switcher.click()
    await expect(page.getByRole('button', { name: allowedName, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: outsideName, exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'All organizations', exact: true })).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Tenant', exact: true })).toHaveCount(0)
  } finally {
    await deleteUserIfExists(request, adminToken, userId)
    await deleteRoleIfExists(request, adminToken, roleId)
    await deleteOrganizationIfExists(request, adminToken, outsideId)
    await deleteOrganizationIfExists(request, adminToken, allowedId)
  }
})
