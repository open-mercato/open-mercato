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
import {
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const DEALS_PATH = '/api/customers/deals'
const PEOPLE_PATH = '/api/customers/people'

test('TC-CRM-9252 opens deal details for a view-only role and denies deal writes', async ({ page, request }) => {
  const stamp = crypto.randomUUID()
  const title = `Deal view access ${stamp}`
  const email = `deal-view-${stamp}@example.com`
  const password = 'DealViewFixture9252!'
  const adminToken = await getAuthToken(request, 'admin')
  const { organizationId, tenantId } = getTokenContext(adminToken)
  let roleId: string | null = null
  let userId: string | null = null
  let personId: string | null = null
  let dealId: string | null = null

  try {
    personId = await createPersonFixture(request, adminToken, { firstName: 'Deal', lastName: 'Viewer', displayName: 'Deal Viewer' })
    dealId = await createDealFixture(request, adminToken, { title, personIds: [personId] })
    roleId = await createRoleFixture(request, adminToken, { name: `Deal viewer ${stamp}`, tenantId })
    await setRoleAclFeatures(request, adminToken, {
      roleId,
      organizations: [organizationId],
      features: [
        'customers.people.view',
        'customers.companies.view',
        'customers.interactions.view',
        'customers.deals.view',
        'customers.pipelines.view',
        'dashboards.view',
        'customers.activities.view',
        'customers.roles.view',
      ],
    })
    userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [roleId] })

    await acknowledgeGlobalNotices(page)
    const loginResponse = await page.request.post('/api/auth/login', { form: { email, password } })
    expect(loginResponse.ok()).toBe(true)
    await page.goto(`/backend/customers/deals/${dealId}`)

    await expect(page.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'true')
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Deal details', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save activity', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Close deal', exact: true })).toHaveCount(0)

    const token = await getAuthToken(request, email, password)
    const detailResponse = await apiRequest(request, 'GET', `${DEALS_PATH}/${dealId}`, { token })
    expect(detailResponse.status()).toBe(200)

    const updateResponse = await apiRequest(request, 'PUT', DEALS_PATH, {
      token,
      data: { id: dealId, title: 'Unauthorized update' },
    })
    expect(updateResponse.status()).toBe(403)
    expect(await readJsonSafe<{ requiredFeatures?: string[] }>(updateResponse)).toMatchObject({
      requiredFeatures: ['customers.deals.manage'],
    })
    const deleteResponse = await apiRequest(request, 'DELETE', `${DEALS_PATH}?id=${dealId}`, { token })
    expect(deleteResponse.status()).toBe(403)
    expect(await readJsonSafe<{ requiredFeatures?: string[] }>(deleteResponse)).toMatchObject({
      requiredFeatures: ['customers.deals.manage'],
    })
  } finally {
    await deleteEntityIfExists(request, adminToken, DEALS_PATH, dealId)
    await deleteEntityIfExists(request, adminToken, PEOPLE_PATH, personId)
    await deleteUserIfExists(request, adminToken, userId)
    await deleteRoleIfExists(request, adminToken, roleId)
  }
})
