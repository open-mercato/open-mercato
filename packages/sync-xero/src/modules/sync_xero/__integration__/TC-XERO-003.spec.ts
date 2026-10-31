import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { isXeroTestFakesAvailable, resetXeroFakes, seedXeroFakes, startXeroFakes } from './helpers/xeroTestFakes'

const XERO_ORGANISATION = { tenantId: 'a1b2c3d4-0000-4000-8000-0000000000a1', connectionId: 'c1c1c1c1-0000-4000-8000-0000000000c1', name: 'Demo Company (Global)' }
const CONTACT_ID = 'c0ffee00-0000-4000-8000-000000000003'
const PASSWORD = 'Valid1!Pass'

async function signIn(page: Page, email: string, context: { tenantId: string; organizationId: string }): Promise<void> {
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({ email, password: PASSWORD }).toString(),
  })
  expect(response.ok(), `login answered ${response.status()}`).toBeTruthy()
  const url = process.env.BASE_URL || 'http://localhost:3000'
  await page.context().addCookies([
    { name: 'om_selected_tenant', value: context.tenantId, url, sameSite: 'Lax' },
    { name: 'om_selected_org', value: context.organizationId, url, sameSite: 'Lax' },
  ])
}

async function openCompany(page: Page, companyId: string, displayName: string): Promise<void> {
  await page.goto(`/backend/customers/companies-v2/${companyId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText(displayName).first()).toBeVisible({ timeout: 30_000 })
}

async function readStatus(request: APIRequestContext, path: string, token: string): Promise<number> {
  return (await apiRequest(request, 'GET', path, { token })).status()
}

/**
 * TC-XERO-003: the Xero badge on the Company page. A user who holds customers.companies.view but
 * not integrations.view sees "Xero · linked since …" with a link to the Contact in Xero on a
 * Company with a Xero mapping, and no badge on a Company without one. Paths: companies/[id], the
 * badge widget.
 */
test.describe('TC-XERO-003: the Xero badge on the Company page', () => {
  test.describe.configure({ timeout: 180_000 })

  let adminToken = ''
  let roleId: string | null = null
  let userId: string | null = null
  const companyIds: string[] = []

  test.beforeEach(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin')
    test.skip(!(await isXeroTestFakesAvailable(request, adminToken)), 'OM_ENABLE_TEST_OAUTH_GRANTS is off in the app under test')
    await resetXeroFakes(request, adminToken)
  })

  test.afterEach(async ({ request }) => {
    await resetXeroFakes(request, adminToken).catch(() => undefined)
    for (const companyId of companyIds.splice(0)) await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
    await deleteUserIfExists(request, adminToken, userId)
    await deleteRoleIfExists(request, adminToken, roleId)
    userId = null
    roleId = null
  })

  test('shows the badge on a mapped Company to a user without integrations.view, and none on an unmapped one', async ({ page, request }) => {
    const stamp = Date.now()
    const context = getTokenContext(adminToken)
    const mappedName = `QA Xero badge ${stamp}`
    const plainName = `QA Xero plain ${stamp}`
    const mappedId = await createCompanyFixture(request, adminToken, mappedName)
    companyIds.push(mappedId)
    const plainId = await createCompanyFixture(request, adminToken, plainName)
    companyIds.push(plainId)

    await startXeroFakes(request, adminToken)
    await seedXeroFakes(request, adminToken, {
      organisations: [XERO_ORGANISATION],
      mappings: [{ localId: mappedId, externalId: `${XERO_ORGANISATION.tenantId}:${CONTACT_ID}` }],
    })

    roleId = await createRoleFixture(request, adminToken, { name: `qa-xero-badge-${stamp}` })
    await setRoleAclFeatures(request, adminToken, { roleId, features: ['customers.companies.view'] })
    const email = `qa-xero-badge-${stamp}@test.invalid`
    userId = await createUserFixture(request, adminToken, { email, password: PASSWORD, organizationId: context.organizationId, roles: [roleId] })

    const viewerToken = await getAuthToken(request, email, PASSWORD)
    expect(await readStatus(request, '/api/sync_xero/connection', viewerToken)).toBe(403)
    const badgeResponse = await apiRequest(request, 'GET', `/api/sync_xero/companies/${mappedId}`, { token: viewerToken })
    expect(badgeResponse.status()).toBe(200)
    expect(await badgeResponse.json()).toMatchObject({ link: { externalUrl: `https://go.xero.com/Contacts/View/${CONTACT_ID}` } })
    const plainResponse = await apiRequest(request, 'GET', `/api/sync_xero/companies/${plainId}`, { token: viewerToken })
    expect(await plainResponse.json()).toEqual({ link: null })

    await signIn(page, email, context)
    await openCompany(page, mappedId, mappedName)
    const badge = page.getByTestId('sync-xero-company-badge')
    await expect(badge).toBeVisible({ timeout: 30_000 })
    await expect(badge).toContainText('Xero · linked since')
    await expect(badge.getByRole('link', { name: 'Open the contact in Xero' })).toHaveAttribute('href', `https://go.xero.com/Contacts/View/${CONTACT_ID}`)

    const plainBadgeCall = page.waitForResponse((response) => response.url().includes(`/api/sync_xero/companies/${plainId}`), { timeout: 30_000 })
    await openCompany(page, plainId, plainName)
    expect((await plainBadgeCall).status()).toBe(200)
    await expect(page.getByTestId('sync-xero-company-badge')).toHaveCount(0)
  })
})
